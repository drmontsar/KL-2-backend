import { buildNursingCarePlan } from '../../clinical/nursing';
import {
  Assessment,
  AssessmentBodyInput,
  Call,
  CallBodyInput,
  Fluid,
  FluidBodyInput,
  NursingTask,
  TaskBodyInput,
  Weight,
  WeightBodyInput,
} from '../../contracts/nursing';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { notifChannel } from './notifications';
import { escalateLowUrine, getUrineOutput } from './urine_output';

type Json = Parameters<(typeof db)['json']>[0];

export async function listNursingAssessments(id: string) {
  return db<
    Assessment[]
  >`SELECT * FROM clinical.nursing_assessments WHERE admission_id = ${id} ORDER BY assessed_at DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function signNursingAssessment(
  id: string,
  actor_user_id: string,
  body: AssessmentBodyInput,
) {
  const scores = buildNursingCarePlan(body);
  return db
    .begin(async (tx) => {
      const [admission] =
        await tx`SELECT id FROM clinical.admissions WHERE id = ${id} AND status = 'active' FOR UPDATE`;
      if (!admission) return null;
      const [assessment] = await tx<Assessment[]>`
      INSERT INTO clinical.nursing_assessments
        (admission_id, assessed_by, arrival_source, transport_mode, identity_verified, allergy_verified, language, belongings, dependence, skin,
         vulnerabilities, devices, pain_score, pain_site, morse, morse_score, braden, braden_score, must, must_score, care_plan, reassess_by)
      VALUES (${id}, ${actor_user_id}, ${body.arrival_source}, ${body.transport_mode}, true, true, ${body.language}, ${body.belongings}, ${body.dependence}, ${body.skin},
        ${tx.json(body.vulnerabilities)}, ${tx.json(body.devices)}, ${body.pain_score}, ${body.pain_site}, ${tx.json(body.morse)}, ${scores.morse},
        ${tx.json(body.braden)}, ${scores.braden}, ${tx.json(body.must)}, ${scores.must}, ${tx.json(scores.care_plan)}, now() + interval '24 hours') RETURNING *
    `;
      await tx`UPDATE clinical.nursing_recurring_tasks SET status = 'cancelled' WHERE admission_id = ${id} AND source_assessment_id IS NOT NULL AND status = 'active'`;
      for (const task of scores.tasks) {
        await tx`
        INSERT INTO clinical.nursing_recurring_tasks (admission_id, source_assessment_id, description, interval_minutes, due_at, created_by)
        VALUES (${id}, ${assessment.id}, ${task.description}, ${task.interval_minutes}, now() + make_interval(mins => ${task.interval_minutes}), ${actor_user_id})
      `;
      }
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'sign', 'clinical.nursing_assessments', ${assessment.id}, ${tx.json(assessment as unknown as Json)})`;
      return assessment;
    })
    .catch(rethrowDatabaseError);
}

export async function listNursingTasks(id: string) {
  return db<
    NursingTask[]
  >`SELECT * FROM clinical.nursing_recurring_tasks WHERE admission_id = ${id} AND status = 'active' ORDER BY due_at`.catch(
    rethrowDatabaseError,
  );
}

export async function createNursingTask(body: TaskBodyInput, actor_user_id: string, id: string) {
  return db
    .begin(async (tx) => {
      const [task] = await tx<NursingTask[]>`
      INSERT INTO clinical.nursing_recurring_tasks (admission_id, description, interval_minutes, due_at, created_by)
      SELECT id, ${body.description}, ${body.interval_minutes}, ${body.due_at}::timestamptz, ${actor_user_id} FROM clinical.admissions WHERE id = ${id} AND status = 'active' RETURNING *
    `;
      if (!task) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'create', 'clinical.nursing_recurring_tasks', ${task.id}, ${tx.json(task as unknown as Json)})`;
      return task;
    })
    .catch(rethrowDatabaseError);
}

export async function getNursingTask(id: string) {
  return db<NursingTask[]>`SELECT * FROM clinical.nursing_recurring_tasks WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function completeNursingTask(
  admission_id: string,
  id: string,
  expected_due_at: string,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [admission] =
        await tx`SELECT id FROM clinical.admissions WHERE id = ${admission_id} AND status = 'active' FOR UPDATE`;
      if (!admission) return null;
      const [task] = await tx<
        NursingTask[]
      >`SELECT * FROM clinical.nursing_recurring_tasks WHERE id = ${id} AND status = 'active' AND date_trunc('milliseconds', due_at) = ${expected_due_at}::timestamptz
        AND due_at <= now() + LEAST(interval '15 minutes', make_interval(mins => interval_minutes) / 2) FOR UPDATE`;
      if (!task) return null;
      const [updated] = await tx<NursingTask[]>`
      UPDATE clinical.nursing_recurring_tasks SET last_completed_at = now(), due_at = now() + make_interval(mins => interval_minutes) WHERE id = ${id} RETURNING *
    `;
      await tx`INSERT INTO clinical.nursing_task_completions (task_id, completed_by, previous_due_at) VALUES (${id}, ${actor_user_id}, ${task.due_at})`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'complete', 'clinical.nursing_recurring_tasks', ${id}, ${tx.json(updated as unknown as Json)})`;
      return updated;
    })
    .catch(rethrowDatabaseError);
}

export async function recordPatientWeight(
  id: string,
  body: WeightBodyInput,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [admission] = await tx<{ assigned_doctor_id: string | null }[]>`
      SELECT assigned_doctor_id FROM clinical.admissions WHERE id = ${id} AND status = 'active' FOR UPDATE
    `;
      if (!admission) return null;
      const [row] = await tx<Weight[]>`
      INSERT INTO clinical.patient_weights (admission_id, weight_kg, measured_at, recorded_by)
      SELECT id, ${body.weight_kg}, ${body.measured_at}::timestamptz, ${actor_user_id}
      FROM clinical.admissions WHERE id = ${id} AND status = 'active' AND ${body.measured_at}::timestamptz <= now() RETURNING *
    `;
      if (!row) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'record', 'clinical.patient_weights', ${row.id}, ${tx.json(row as unknown as Json)})`;
      await escalateLowUrine(tx, id, actor_user_id, admission.assigned_doctor_id);
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function recordFluidEntry(id: string, actor_user_id: string, body: FluidBodyInput) {
  return db
    .begin(async (tx) => {
      const [admission] = await tx<{ assigned_doctor_id: string | null }[]>`
      SELECT assigned_doctor_id FROM clinical.admissions WHERE id = ${id} AND status = 'active' FOR UPDATE
    `;
      if (!admission) return null;
      const [fluid] = await tx<Fluid[]>`
      INSERT INTO clinical.fluid_entries (admission_id, recorded_by, direction, category, volume_ml, occurred_at)
      SELECT id, ${actor_user_id}, ${body.direction}, ${body.category}, ${body.volume_ml}, ${body.occurred_at}::timestamptz
      FROM clinical.admissions WHERE id = ${id} AND status = 'active' RETURNING *
    `;
      if (!fluid) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'record', 'clinical.fluid_entries', ${fluid.id}, ${tx.json(fluid as unknown as Json)})`;
      if (body.direction === 'output' && body.category.toLowerCase() === 'urine') {
        await escalateLowUrine(tx, id, actor_user_id, admission.assigned_doctor_id);
      }
      return fluid;
    })
    .catch(rethrowDatabaseError);
}

export async function getFluidBalance(id: string, from: string, to: string) {
  const entries = await db<
    Fluid[]
  >`SELECT * FROM clinical.fluid_entries WHERE admission_id = ${id} AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz ORDER BY occurred_at DESC`.catch(
    rethrowDatabaseError,
  );
  const intake_ml = entries
    .filter((entry) => entry.direction === 'intake')
    .reduce((sum, entry) => sum + entry.volume_ml, 0);
  const output_ml = entries
    .filter((entry) => entry.direction === 'output')
    .reduce((sum, entry) => sum + entry.volume_ml, 0);
  const urine_alert = await getUrineOutput(db, id);
  return { entries, intake_ml, output_ml, balance_ml: intake_ml - output_ml, urine_alert };
}

export async function sendSbarCall(actor_user_id: string, body: CallBodyInput, id: string) {
  return db
    .begin(async (tx) => {
      const [call] = await tx<Call[]>`
      INSERT INTO clinical.nursing_sbar_calls (admission_id, called_by, doctor_id, situation, background, assessment, request)
      SELECT a.id, ${actor_user_id}, u.id, ${body.situation}, ${body.background}, ${body.assessment}, ${body.request}
      FROM clinical.admissions a JOIN staff.users u ON u.id = ${body.doctor_id} AND u.role = 'doctor' AND u.disabled_at IS NULL
      WHERE a.id = ${id} AND a.status = 'active' AND a.assigned_doctor_id = u.id RETURNING *
    `;
      if (!call) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'send', 'clinical.nursing_sbar_calls', ${call.id}, ${tx.json(call as unknown as Json)})`;
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`
      INSERT INTO clinical.notifications (user_id, type, payload) VALUES (${body.doctor_id}, 'nursing.sbar_call', ${tx.json({ call_id: call.id, admission_id: id })}) RETURNING *
    `;
      await tx`SELECT pg_notify(${notifChannel(body.doctor_id)}, ${JSON.stringify(notification)})`;
      return call;
    })
    .catch(rethrowDatabaseError);
}

export async function listSbarCalls(actor_user_id: string) {
  return db<
    Call[]
  >`SELECT * FROM clinical.nursing_sbar_calls WHERE called_by = ${actor_user_id} OR doctor_id = ${actor_user_id} ORDER BY created_at DESC LIMIT 100`.catch(
    rethrowDatabaseError,
  );
}

export async function acknowledgeSbarCall(reply: string, id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [call] = await tx<
        Call[]
      >`UPDATE clinical.nursing_sbar_calls SET status = 'acknowledged', acknowledged_at = now(), reply = ${reply} WHERE id = ${id} AND doctor_id = ${actor_user_id} AND status = 'open' RETURNING *`;
      if (!call) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'acknowledge', 'clinical.nursing_sbar_calls', ${id}, ${tx.json(call as unknown as Json)})`;
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`
      INSERT INTO clinical.notifications (user_id, type, payload) VALUES (${call.called_by}, 'nursing.sbar_acknowledged', ${tx.json({ call_id: id, admission_id: call.admission_id })}) RETURNING *
    `;
      await tx`SELECT pg_notify(${notifChannel(call.called_by)}, ${JSON.stringify(notification)})`;
      return call;
    })
    .catch(rethrowDatabaseError);
}

export async function closeSbarCall(actor_user_id: string, id: string) {
  return db
    .begin(async (tx) => {
      const [call] = await tx<
        Call[]
      >`UPDATE clinical.nursing_sbar_calls SET status = 'closed', closed_by = ${actor_user_id}, closed_at = now() WHERE id = ${id} AND status = 'acknowledged' AND (called_by = ${actor_user_id} OR doctor_id = ${actor_user_id}) RETURNING *`;
      if (call)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'close', 'clinical.nursing_sbar_calls', ${id}, ${tx.json(call as unknown as Json)})`;
      return call;
    })
    .catch(rethrowDatabaseError);
}
