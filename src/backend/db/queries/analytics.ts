import { db } from '../index';

export type SeverityBreakdown = {
  unstable: number;
  watcher: number;
  stable: number;
};

export type WardCount = {
  ward: string;
  count: number;
};

export type LengthOfStayRow = {
  admission_id: string;
  patient_name: string;
  ward: string | null;
  bed: string | null;
  days: number;
};

export type VitalsAlertRow = {
  admission_id: string;
  patient_name: string;
  ward: string | null;
  bed: string | null;
  flags: string[];
};

export type HandoverPartnerRow = {
  doctor_id: string;
  doctor_name: string;
  count: number;
};

export type CaseMixRow = {
  description: string;
  count: number;
};

export type DoctorAnalytics = {
  // Active roster
  total_active: number;
  severity: SeverityBreakdown;
  by_ward: WardCount[];
  nurse_coverage: { assigned: number; unassigned: number };
  length_of_stay: LengthOfStayRow[];
  vitals_alerts: VitalsAlertRow[];
  pending_tasks_total: number;
  // Career / activity
  career: {
    total_handled: number;   // all admissions ever assigned, any status
    total_discharged: number;
  };
  case_mix: CaseMixRow[];   // top diagnoses across all their admissions
  handover_stats: {
    sessions_received: number;  // handover sessions this doctor received
    sessions_given: number;     // handover sessions this doctor initiated
    received_from: HandoverPartnerRow[];  // who handed over TO this doctor
    given_to: HandoverPartnerRow[];       // who this doctor handed over TO
  };
  transfer_stats: {
    received: number;   // patients transferred TO this doctor
    given: number;      // patients transferred FROM this doctor (transfer-doctor action)
  };
};

// Normal ranges used for vitals alert flags
const RANGES = {
  spo2_low:         'v.spo2 < 94',
  hr_high:          'v.heart_rate > 100',
  hr_low:           'v.heart_rate < 50',
  bp_systolic_high: 'v.bp_systolic > 160',
  bp_systolic_low:  'v.bp_systolic < 90',
  temp_high:        'v.temperature > 38.5',
  temp_low:         'v.temperature < 36.0',
  glucose_high:     'v.glucose > 200',
  glucose_low:      'v.glucose < 70',
};

export async function getDoctorAnalytics(doctor_id: string): Promise<DoctorAnalytics> {
  const [result] = await db`
    WITH active AS (
      SELECT a.id, a.severity, a.ward, a.bed, a.assigned_to, a.admitted_at, p.name AS patient_name
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE a.assigned_doctor_id = ${doctor_id} AND a.status = 'active'
    ),

    severity_counts AS (
      SELECT
        COUNT(*) FILTER (WHERE severity = 'unstable') AS unstable,
        COUNT(*) FILTER (WHERE severity = 'watcher')  AS watcher,
        COUNT(*) FILTER (WHERE severity = 'stable')   AS stable,
        COUNT(*)                                       AS total
      FROM active
    ),

    ward_counts AS (
      SELECT COALESCE(ward, 'Unknown') AS ward, COUNT(*)::int AS count
      FROM active
      GROUP BY ward ORDER BY count DESC
    ),

    nurse_coverage AS (
      SELECT
        COUNT(*) FILTER (WHERE assigned_to IS NOT NULL) AS assigned,
        COUNT(*) FILTER (WHERE assigned_to IS NULL)     AS unassigned
      FROM active
    ),

    los AS (
      SELECT id AS admission_id, patient_name, ward, bed,
             GREATEST(1, EXTRACT(DAY FROM now() - admitted_at)::int) AS days
      FROM active ORDER BY days DESC
    ),

    latest_vitals AS (
      SELECT DISTINCT ON (v.admission_id)
        v.admission_id, v.spo2, v.heart_rate, v.bp_systolic, v.temperature, v.glucose
      FROM clinical.vitals v
      WHERE v.admission_id IN (SELECT id FROM active)
      ORDER BY v.admission_id, v.recorded_at DESC
    ),

    vitals_flagged AS (
      SELECT
        v.admission_id, a.patient_name, a.ward, a.bed,
        array_remove(ARRAY[
          CASE WHEN ${db.unsafe(RANGES.spo2_low)}         THEN 'spo2_low'         END,
          CASE WHEN ${db.unsafe(RANGES.hr_high)}          THEN 'hr_high'          END,
          CASE WHEN ${db.unsafe(RANGES.hr_low)}           THEN 'hr_low'           END,
          CASE WHEN ${db.unsafe(RANGES.bp_systolic_high)} THEN 'bp_systolic_high' END,
          CASE WHEN ${db.unsafe(RANGES.bp_systolic_low)}  THEN 'bp_systolic_low'  END,
          CASE WHEN ${db.unsafe(RANGES.temp_high)}        THEN 'temp_high'        END,
          CASE WHEN ${db.unsafe(RANGES.temp_low)}         THEN 'temp_low'         END,
          CASE WHEN ${db.unsafe(RANGES.glucose_high)}     THEN 'glucose_high'     END,
          CASE WHEN ${db.unsafe(RANGES.glucose_low)}      THEN 'glucose_low'      END
        ], NULL) AS flags
      FROM latest_vitals v
      JOIN active a ON a.id = v.admission_id
    ),

    pending_tasks AS (
      SELECT COUNT(*)::int AS total
      FROM clinical.tasks t
      WHERE t.admission_id IN (SELECT id FROM active) AND t.status = 'pending'
    ),

    -- Career: all admissions ever assigned to this doctor
    career AS (
      SELECT
        COUNT(*)                                            AS total_handled,
        COUNT(*) FILTER (WHERE status = 'discharged')      AS total_discharged
      FROM clinical.admissions
      WHERE assigned_doctor_id = ${doctor_id}
    ),

    -- Top diagnoses across all of this doctor's admissions (active + discharged)
    case_mix AS (
      SELECT d.description, COUNT(*)::int AS count
      FROM clinical.diagnoses d
      JOIN clinical.admissions a ON a.id = d.admission_id
      WHERE a.assigned_doctor_id = ${doctor_id}
      GROUP BY d.description
      ORDER BY count DESC
      LIMIT 10
    ),

    -- Handover sessions: how many received vs given, and from/to whom
    sessions_received AS (
      SELECT hs.outgoing_doctor_id, u.name AS doctor_name, COUNT(*)::int AS count
      FROM clinical.handover_sessions hs
      JOIN staff.users u ON u.id = hs.outgoing_doctor_id
      WHERE hs.incoming_doctor_id = ${doctor_id}
      GROUP BY hs.outgoing_doctor_id, u.name
      ORDER BY count DESC
    ),

    sessions_given AS (
      SELECT hs.incoming_doctor_id, u.name AS doctor_name, COUNT(*)::int AS count
      FROM clinical.handover_sessions hs
      JOIN staff.users u ON u.id = hs.incoming_doctor_id
      WHERE hs.outgoing_doctor_id = ${doctor_id}
      GROUP BY hs.incoming_doctor_id, u.name
      ORDER BY count DESC
    ),

    -- Transfer events from audit log
    transfers_received AS (
      SELECT COUNT(*)::int AS total
      FROM clinical.audit_log
      WHERE action = 'transfer'
        AND record_table = 'clinical.admissions'
        AND (after->>'assigned_doctor_id') = ${doctor_id}
    ),

    transfers_given AS (
      SELECT COUNT(*)::int AS total
      FROM clinical.audit_log
      WHERE action = 'transfer'
        AND record_table = 'clinical.admissions'
        AND actor_user_id = ${doctor_id}::uuid
    )

    SELECT json_build_object(
      'total_active',        sc.total,
      'severity',            json_build_object('unstable', sc.unstable, 'watcher', sc.watcher, 'stable', sc.stable),
      'by_ward',             (SELECT json_agg(json_build_object('ward', ward, 'count', count)) FROM ward_counts),
      'nurse_coverage',      json_build_object('assigned', nc.assigned, 'unassigned', nc.unassigned),
      'length_of_stay',      (SELECT json_agg(json_build_object('admission_id', admission_id, 'patient_name', patient_name, 'ward', ward, 'bed', bed, 'days', days)) FROM los),
      'vitals_alerts',       (SELECT json_agg(json_build_object('admission_id', admission_id, 'patient_name', patient_name, 'ward', ward, 'bed', bed, 'flags', flags)) FROM vitals_flagged WHERE array_length(flags, 1) > 0),
      'pending_tasks_total', pt.total,
      'career',              json_build_object('total_handled', c.total_handled, 'total_discharged', c.total_discharged),
      'case_mix',            (SELECT json_agg(json_build_object('description', description, 'count', count)) FROM case_mix),
      'handover_stats',      json_build_object(
                               'sessions_received', (SELECT COALESCE(SUM(count), 0) FROM sessions_received),
                               'sessions_given',    (SELECT COALESCE(SUM(count), 0) FROM sessions_given),
                               'received_from',     (SELECT json_agg(json_build_object('doctor_id', outgoing_doctor_id, 'doctor_name', doctor_name, 'count', count)) FROM sessions_received),
                               'given_to',          (SELECT json_agg(json_build_object('doctor_id', incoming_doctor_id, 'doctor_name', doctor_name, 'count', count)) FROM sessions_given)
                             ),
      'transfer_stats',      json_build_object('received', tr.total, 'given', tg.total)
    ) AS data
    FROM severity_counts sc, nurse_coverage nc, pending_tasks pt,
         career c, transfers_received tr, transfers_given tg
  `;

  const data = result.data as DoctorAnalytics;
  data.vitals_alerts                    = data.vitals_alerts                    ?? [];
  data.length_of_stay                   = data.length_of_stay                   ?? [];
  data.by_ward                          = data.by_ward                          ?? [];
  data.case_mix                         = data.case_mix                         ?? [];
  data.handover_stats.received_from     = data.handover_stats.received_from     ?? [];
  data.handover_stats.given_to          = data.handover_stats.given_to          ?? [];
  return data;
}
