import { CreateBodyInput, Plan, Task } from '../../contracts/discharge_plans';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { canAccessAdmission } from './access';
import type { User } from './users';

type Json = Parameters<(typeof db)['json']>[0];

export async function canAccessDischargePlan(user: User, admissionId: string): Promise<boolean> {
  if (['billing_insurance', 'pharmacist'].includes(user.job_role)) {
    const [row] =
      await db`SELECT a.id FROM clinical.admissions a JOIN staff.unit_memberships m ON m.unit_id = a.unit_id WHERE a.id = ${admissionId} AND m.user_id = ${user.id}`;
    return Boolean(row);
  }
  return canAccessAdmission(user, admissionId);
}

export const getDischargePlan = async (id: string) =>
  (await db<Plan[]>`SELECT * FROM clinical.discharge_plans WHERE id = ${id}`)[0];

export async function createDischargePlan(body: CreateBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [admission] =
        await tx`SELECT id, patient_id FROM clinical.admissions WHERE id = ${body.admission_id} AND status = 'active' FOR UPDATE`;
      if (!admission) return null;
      if (body.form_version_id) {
        const [form] =
          await tx`SELECT v.id FROM forms.instance_versions v JOIN forms.instances i ON i.id = v.instance_id WHERE v.id = ${body.form_version_id} AND i.admission_id = ${body.admission_id} AND v.status = 'final'`;
        if (!form) return null;
      }
      const [plan] = await tx<Plan[]>`
        INSERT INTO clinical.discharge_plans (admission_id, discharge_type, planned_at, condition, follow_up, form_version_id, requested_by)
        VALUES (${body.admission_id}, ${body.discharge_type}, ${body.planned_at}::timestamptz, ${body.condition}, ${body.follow_up}, ${body.form_version_id ?? null}, ${actor_user_id}) RETURNING *
      `;
      await tx`
        INSERT INTO clinical.discharge_tasks (plan_id, code)
        SELECT ${plan.id}, code FROM unnest(ARRAY['summary','pending_results','medication_reconciliation','nursing','billing','payment']) AS code
      `;
      const [coverage] =
        await tx`SELECT id FROM clinical.patient_coverage WHERE patient_id = ${admission.patient_id} LIMIT 1`;
      if (coverage)
        await tx`INSERT INTO clinical.discharge_tasks (plan_id, code) VALUES (${plan.id}, 'insurance')`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'request', 'clinical.discharge_plans', ${plan.id}, ${tx.json(plan as unknown as Json)})`;
      return plan;
    })
    .catch(rethrowDatabaseError);
}

export async function listDischargePlans(id: string) {
  return db<
    Plan[]
  >`SELECT * FROM clinical.discharge_plans WHERE admission_id = ${id} ORDER BY requested_at DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function cancelDischargePlan(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<
        Plan[]
      >`UPDATE clinical.discharge_plans SET status = 'cancelled', revision = revision + 1 WHERE id = ${id} AND status IN ('pending_approval','approved') RETURNING *`;
      if (row)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'cancel', 'clinical.discharge_plans', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function listDischargeTasks(id: string) {
  return db<
    Task[]
  >`SELECT * FROM clinical.discharge_tasks WHERE plan_id = ${id} ORDER BY code`.catch(
    rethrowDatabaseError,
  );
}

export async function approveDischargePlan(actor_user_id: string, id: string) {
  return db
    .begin(async (tx) => {
      const [plan] = await tx<Plan[]>`
      UPDATE clinical.discharge_plans p SET status = 'approved', approved_by = ${actor_user_id}, approved_at = now(), revision = p.revision + 1
      FROM clinical.admissions a
      WHERE p.id = ${id} AND p.admission_id = a.id AND a.status = 'active' AND p.status = 'pending_approval'
        AND EXISTS (SELECT 1 FROM clinical.staff_assignments sa WHERE sa.admission_id = a.id AND sa.user_id = ${actor_user_id} AND sa.assignment_type = 'treating_consultant' AND sa.ends_at IS NULL)
        AND (p.discharge_type <> 'home' OR EXISTS (SELECT 1 FROM clinical.latest_news2 n WHERE n.admission_id = a.id AND n.news2_score < 5))
      RETURNING p.*
    `;
      if (plan)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'approve', 'clinical.discharge_plans', ${id}, ${tx.json(plan as unknown as Json)})`;
      return plan;
    })
    .catch(rethrowDatabaseError);
}

export async function signDischargeSummary(summary: string, actor_user_id: string, id: string) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<
        Plan[]
      >`UPDATE clinical.discharge_plans SET summary = ${summary}, summary_signed_by = ${actor_user_id}, summary_signed_at = now(), revision = revision + 1 WHERE id = ${id} AND status IN ('pending_approval','approved') AND summary_signed_at IS NULL RETURNING *`;
      if (!row) return null;
      await tx`UPDATE clinical.discharge_tasks SET status = 'completed', evidence = 'Summary signed', completed_by = ${actor_user_id}, completed_at = now() WHERE plan_id = ${id} AND code = 'summary' AND status = 'pending'`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'sign_summary', 'clinical.discharge_plans', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function getDischargeTask(id: string) {
  return db<
    (Task & { admission_id: string })[]
  >`SELECT t.*, p.admission_id FROM clinical.discharge_tasks t JOIN clinical.discharge_plans p ON p.id = t.plan_id WHERE t.id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function completeDischargeTask(id: string, evidence: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [existing] = await tx<Task[]>`SELECT * FROM clinical.discharge_tasks WHERE id = ${id}`;
      if (!existing) return null;
      const [plan] = await tx<
        Plan[]
      >`SELECT * FROM clinical.discharge_plans WHERE id = ${existing.plan_id} AND status IN ('pending_approval','approved') FOR UPDATE`;
      if (!plan) return null;
      if (existing.code === 'billing') {
        const [unresolved] =
          await tx`SELECT id FROM clinical.discharge_tasks WHERE plan_id = ${plan.id} AND code = 'pending_results' AND status <> 'completed'`;
        if (unresolved) return null;
      }
      if (existing.code === 'insurance') {
        const [claim] =
          await tx`SELECT id FROM finance.claims WHERE admission_id = ${plan.admission_id} AND status = 'discharge_billed' AND final_approved`;
        if (!claim) return null;
      }
      const [task] = await tx<
        Task[]
      >`UPDATE clinical.discharge_tasks SET status = 'completed', evidence = ${evidence}, completed_by = ${actor_user_id}, completed_at = now() WHERE id = ${id} AND status = 'pending' RETURNING *`;
      if (task)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'complete', 'clinical.discharge_tasks', ${id}, ${tx.json(task as unknown as Json)})`;
      return task;
    })
    .catch(rethrowDatabaseError);
}

export async function completeDischarge(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [plan] = await tx<
        Plan[]
      >`SELECT * FROM clinical.discharge_plans WHERE id = ${id} AND status = 'approved' FOR UPDATE`;
      if (!plan) return null;
      const [admission] = await tx<
        { id: string; bed_id: string | null; patient_id: string }[]
      >`SELECT id, bed_id, patient_id FROM clinical.admissions WHERE id = ${plan.admission_id} AND status = 'active' FOR UPDATE`;
      if (!admission) return null;
      const [pending] =
        await tx`SELECT id FROM clinical.discharge_tasks WHERE plan_id = ${id} AND status <> 'completed' LIMIT 1`;
      const [movement] =
        await tx`SELECT id FROM clinical.patient_movements WHERE admission_id = ${plan.admission_id} AND status IN ('requested','reserved','in_transit') LIMIT 1`;
      if (pending || movement || !plan.summary_signed_at) return null;
      if (plan.discharge_type === 'home') {
        const [news] = await tx<
          { news2_score: number }[]
        >`SELECT news2_score FROM clinical.latest_news2 WHERE admission_id = ${plan.admission_id}`;
        if (!news || news.news2_score >= 5) return null;
      } else {
        if (!plan.form_version_id) return null;
        const [form] = await tx`
        SELECT v.id FROM forms.instance_versions v JOIN forms.instances i ON i.id = v.instance_id JOIN forms.templates t ON t.id = i.template_id
        WHERE v.id = ${plan.form_version_id} AND v.status = 'final' AND i.admission_id = ${plan.admission_id}
          AND ((${plan.discharge_type} = 'referral' AND t.name ILIKE '%referral%') OR (${plan.discharge_type} = 'lama' AND t.name ILIKE '%lama%'))
      `;
        if (!form) return null;
      }
      const [insured] =
        await tx`SELECT id FROM clinical.patient_coverage WHERE patient_id = ${admission.patient_id} LIMIT 1`;
      if (insured) {
        const [claim] =
          await tx`SELECT id FROM finance.claims WHERE admission_id = ${plan.admission_id} AND status = 'discharge_billed' AND final_approved`;
        if (!claim) return null;
      }
      await tx`UPDATE clinical.admissions SET status = 'discharged', discharged_at = now(), exit_type = ${plan.discharge_type === 'home' ? 'discharged' : plan.discharge_type === 'referral' ? 'transfer_out' : 'lama'}, revision = revision + 1 WHERE id = ${plan.admission_id}`;
      await tx`UPDATE clinical.bed_assignments SET ends_at = now(), end_reason = 'discharge' WHERE admission_id = ${plan.admission_id} AND ends_at IS NULL`;
      if (admission.bed_id)
        await tx`UPDATE organization.beds SET operational_state = 'cleaning' WHERE id = ${admission.bed_id}`;
      const [completed] = await tx<
        Plan[]
      >`UPDATE clinical.discharge_plans SET status = 'completed', completed_by = ${actor_user_id}, completed_at = now(), revision = revision + 1 WHERE id = ${id} RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'complete', 'clinical.discharge_plans', ${id}, ${tx.json(completed as unknown as Json)})`;
      return completed;
    })
    .catch(rethrowDatabaseError);
}
