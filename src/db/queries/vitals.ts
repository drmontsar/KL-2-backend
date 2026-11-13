import {
  calculateNews2,
  NEWS2_RULE_VERSION,
  observationFrequencyMinutes,
  type Consciousness,
  type News2Input,
} from '../../clinical/news2';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';

export type Vitals = {
  id: string;
  admission_id: string;
  recorded_by: string;
  recorded_at: Date;
  event_order: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  heart_rate: number | null;
  spo2: number | null;
  resp_rate: number | null;
  temperature: number | null;
  glucose: number | null;
  on_supplemental_oxygen: boolean | null;
  consciousness: Consciousness | null;
  news2_score: number | null;
  news2_escalation: 'low' | 'low-medium' | 'medium' | 'high' | null;
  news2_component_scores: Record<string, number> | null;
  news2_rule_version: string | null;
};

export type ClinicalAlert = {
  id: string;
  admission_id: string;
  source_vitals_id: string | null;
  type: 'news2' | 'low_urine_output';
  severity: 'caution' | 'warning';
  message: string;
  status: 'active' | 'acknowledged' | 'resolved' | 'superseded';
  created_at: Date;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_reason: string | null;
  superseded_by: string | null;
};

export type ObservationSchedule = {
  admission_id: string;
  frequency_minutes: number;
  next_due_at: Date;
  source: 'news2_policy' | 'manual';
  reason: string | null;
  policy_version: string;
  updated_by: string | null;
  updated_at: Date;
  due_status: 'scheduled' | 'due' | 'overdue';
};

export type LatestNews2 = {
  admission_id: string;
  observation_id: string;
  recorded_at: Date;
  news2_score: number;
  news2_escalation: 'low' | 'low-medium' | 'medium' | 'high';
  news2_component_scores: Record<string, number>;
  news2_rule_version: string;
  frequency_minutes: number | null;
  next_due_at: Date | null;
  due_status: 'scheduled' | 'due' | 'overdue' | null;
};

export async function recordVitals(data: {
  admission_id: string;
  recorded_by: string;
  bp_systolic?: number;
  bp_diastolic?: number;
  heart_rate?: number;
  spo2?: number;
  resp_rate?: number;
  temperature?: number;
  glucose?: number;
}): Promise<Vitals | null> {
  return db
    .begin(async (tx) => {
      const [admission] =
        await tx`SELECT id FROM clinical.admissions WHERE id = ${data.admission_id} AND status = 'active' FOR UPDATE`;
      if (!admission) return null;
      const [row] = await tx<Vitals[]>`
      INSERT INTO clinical.vitals
        (admission_id, recorded_by, recorded_at, bp_systolic, bp_diastolic, heart_rate, spo2, resp_rate, temperature, glucose)
      VALUES
        (${data.admission_id}, ${data.recorded_by}, clock_timestamp(),
         ${data.bp_systolic ?? null}, ${data.bp_diastolic ?? null}, ${data.heart_rate ?? null},
         ${data.spo2 ?? null}, ${data.resp_rate ?? null}, ${data.temperature ?? null}, ${data.glucose ?? null})
      RETURNING *
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.recorded_by}, 'create', 'clinical.vitals', ${row.id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function recordObservation(
  data: News2Input & {
    admission_id: string;
    recorded_by: string;
    bp_diastolic?: number;
    glucose?: number;
  },
): Promise<Vitals | null> {
  const news2 = calculateNews2(data);

  return db
    .begin(async (tx) => {
      const [admission] =
        await tx`SELECT id FROM clinical.admissions WHERE id = ${data.admission_id} AND status = 'active' FOR UPDATE`;
      if (!admission) return null;
      const [row] = await tx<Vitals[]>`
      INSERT INTO clinical.vitals
        (admission_id, recorded_by, recorded_at, bp_systolic, bp_diastolic, heart_rate, spo2,
         resp_rate, temperature, glucose, on_supplemental_oxygen, consciousness,
         news2_score, news2_escalation, news2_component_scores, news2_rule_version)
      VALUES
        (${data.admission_id}, ${data.recorded_by}, clock_timestamp(), ${data.bp_systolic},
         ${data.bp_diastolic ?? null}, ${data.heart_rate}, ${data.spo2},
         ${data.resp_rate}, ${data.temperature}, ${data.glucose ?? null},
         ${data.on_supplemental_oxygen}, ${data.consciousness}, ${news2.score},
         ${news2.escalation}, ${tx.json(news2.component_scores)}, ${NEWS2_RULE_VERSION})
      RETURNING *
    `;

      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.recorded_by}, 'create', 'clinical.vitals', ${row.id}, ${tx.json(row)})
    `;

      const policyFrequency = observationFrequencyMinutes(news2);

      await tx`
      INSERT INTO clinical.observation_schedules
        (admission_id, frequency_minutes, next_due_at, source, policy_version, updated_by)
      VALUES
        (${data.admission_id}, ${policyFrequency}, ${row.recorded_at} + make_interval(mins => ${policyFrequency}),
         'news2_policy', ${NEWS2_RULE_VERSION}, ${data.recorded_by})
      ON CONFLICT (admission_id) DO UPDATE SET
        frequency_minutes = CASE
          WHEN clinical.observation_schedules.source = 'manual'
            THEN LEAST(clinical.observation_schedules.frequency_minutes, EXCLUDED.frequency_minutes)
          ELSE EXCLUDED.frequency_minutes
        END,
        next_due_at = ${row.recorded_at} + make_interval(mins => CASE
          WHEN clinical.observation_schedules.source = 'manual'
            THEN LEAST(clinical.observation_schedules.frequency_minutes, EXCLUDED.frequency_minutes)
          ELSE EXCLUDED.frequency_minutes
        END),
        source = CASE
          WHEN clinical.observation_schedules.source = 'manual'
           AND clinical.observation_schedules.frequency_minutes <= EXCLUDED.frequency_minutes
            THEN 'manual'
          ELSE 'news2_policy'
        END,
        policy_version = EXCLUDED.policy_version,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    `;

      if (news2.escalation === 'low') {
        await tx`
        UPDATE clinical.alerts
        SET status = 'resolved', resolved_by = ${data.recorded_by}, resolved_at = now(),
            resolution_reason = 'Subsequent NEWS2 returned to low escalation'
        WHERE admission_id = ${data.admission_id} AND type = 'news2'
          AND status IN ('active','acknowledged')
      `;
      } else {
        const severity = news2.escalation === 'high' ? 'warning' : 'caution';
        const instruction =
          news2.escalation === 'high'
            ? 'Emergency response; continuous monitoring'
            : news2.escalation === 'medium'
              ? 'Urgent review within 30 minutes'
              : 'Urgent ward review; single red parameter';
        const [alert] = await tx<ClinicalAlert[]>`
        INSERT INTO clinical.alerts
          (admission_id, source_vitals_id, type, severity, message)
        VALUES
          (${data.admission_id}, ${row.id}, 'news2', ${severity},
           ${`NEWS2 ${news2.score}: ${instruction}`})
        RETURNING *
      `;
        await tx`
        UPDATE clinical.alerts
        SET status = 'superseded', superseded_by = ${alert.id}
        WHERE admission_id = ${data.admission_id} AND type = 'news2'
          AND id <> ${alert.id} AND status IN ('active','acknowledged')
      `;
      }

      return row;
    })
    .catch(rethrowDatabaseError);
}

export function listAlertsByAdmission(
  admission_id: string,
  status?: ClinicalAlert['status'],
): Promise<ClinicalAlert[]> {
  if (status) {
    return db<ClinicalAlert[]>`
      SELECT * FROM clinical.alerts
      WHERE admission_id = ${admission_id} AND status = ${status}
      ORDER BY created_at DESC
    `;
  }
  return db<ClinicalAlert[]>`
    SELECT * FROM clinical.alerts
    WHERE admission_id = ${admission_id}
    ORDER BY created_at DESC
  `;
}

export async function acknowledgeAlert(
  id: string,
  admission_id: string,
  user_id: string,
): Promise<ClinicalAlert | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<ClinicalAlert[]>`
      UPDATE clinical.alerts
      SET status = 'acknowledged', acknowledged_by = ${user_id}, acknowledged_at = now()
      WHERE id = ${id} AND admission_id = ${admission_id} AND status = 'active'
      RETURNING *
    `;
      if (!row) return null;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${user_id}, 'acknowledge', 'clinical.alerts', ${row.id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function resolveAlert(
  id: string,
  admission_id: string,
  user_id: string,
  reason: string,
): Promise<ClinicalAlert | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<ClinicalAlert[]>`
      UPDATE clinical.alerts
      SET status = 'resolved', resolved_by = ${user_id}, resolved_at = now(), resolution_reason = ${reason}
      WHERE id = ${id} AND admission_id = ${admission_id} AND status IN ('active','acknowledged')
      RETURNING *
    `;
      if (!row) return null;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${user_id}, 'resolve', 'clinical.alerts', ${row.id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function getObservationSchedule(
  admission_id: string,
): Promise<ObservationSchedule | null> {
  const [row] = await db<ObservationSchedule[]>`
    SELECT s.*,
      CASE WHEN s.next_due_at <= now() THEN 'overdue'
           WHEN s.next_due_at <= now() + interval '30 minutes' THEN 'due'
           ELSE 'scheduled' END AS due_status
    FROM clinical.observation_schedules s
    WHERE s.admission_id = ${admission_id}
  `;
  return row ?? null;
}

export async function setObservationSchedule(data: {
  admission_id: string;
  frequency_minutes: number;
  reason: string;
  updated_by: string;
}): Promise<ObservationSchedule | null> {
  return db
    .begin(async (tx) => {
      const [admission] =
        await tx`SELECT id FROM clinical.admissions WHERE id = ${data.admission_id} AND status = 'active' FOR UPDATE`;
      if (!admission) return null;
      const [latest] = await tx<
        { news2_score: number; news2_escalation: LatestNews2['news2_escalation'] }[]
      >`
      SELECT news2_score, news2_escalation FROM clinical.latest_news2 WHERE admission_id = ${data.admission_id}
    `;
      if (
        !latest ||
        data.frequency_minutes >
          observationFrequencyMinutes({
            score: latest.news2_score,
            escalation: latest.news2_escalation,
          })
      )
        return null;
      const [row] = await tx<ObservationSchedule[]>`
      INSERT INTO clinical.observation_schedules
        (admission_id, frequency_minutes, next_due_at, source, reason, policy_version, updated_by)
      VALUES
        (${data.admission_id}, ${data.frequency_minutes}, now() + make_interval(mins => ${data.frequency_minutes}),
         'manual', ${data.reason}, ${NEWS2_RULE_VERSION}, ${data.updated_by})
      ON CONFLICT (admission_id) DO UPDATE SET
        frequency_minutes = EXCLUDED.frequency_minutes,
        next_due_at = LEAST(clinical.observation_schedules.next_due_at, EXCLUDED.next_due_at),
        source = 'manual', reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()
      RETURNING *, CASE WHEN next_due_at <= now() THEN 'overdue'
                        WHEN next_due_at <= now() + interval '30 minutes' THEN 'due'
                        ELSE 'scheduled' END AS due_status
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.updated_by}, 'set_observation_schedule', 'clinical.observation_schedules', ${data.admission_id}, ${tx.json({ frequency_minutes: data.frequency_minutes, reason: data.reason })})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function latestNews2(admission_id: string): Promise<LatestNews2 | null> {
  const [row] = await db<LatestNews2[]>`
    SELECT * FROM clinical.latest_news2 WHERE admission_id = ${admission_id}
  `;
  return row ?? null;
}

export function listObservationsByAdmission(admission_id: string, limit = 20): Promise<Vitals[]> {
  return db<Vitals[]>`
    SELECT * FROM clinical.vitals
    WHERE admission_id = ${admission_id} AND news2_score IS NOT NULL
    ORDER BY recorded_at DESC, event_order DESC
    LIMIT ${limit}
  `;
}

export function listVitalsByAdmission(admission_id: string, limit = 20, before?: string): Promise<Vitals[]> {
  return db<Vitals[]>`
    SELECT * FROM clinical.vitals
    WHERE admission_id = ${admission_id}
      AND (${before ?? null}::uuid IS NULL OR (recorded_at, event_order) < (
        SELECT recorded_at, event_order FROM clinical.vitals
        WHERE id = ${before ?? null}::uuid AND admission_id = ${admission_id}
      ))
    ORDER BY recorded_at DESC, event_order DESC
    LIMIT ${limit}
  `;
}

export function latestVitals(admission_id: string): Promise<Vitals | null> {
  return db<Vitals[]>`
    SELECT * FROM clinical.vitals
    WHERE admission_id = ${admission_id}
    ORDER BY recorded_at DESC, event_order DESC
    LIMIT 1
  `.then((rows) => rows[0] ?? null);
}
