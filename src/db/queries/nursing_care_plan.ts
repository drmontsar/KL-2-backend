import { CreateBodyInput, Item, UpdateBodyInput } from '../../contracts/nursing_care_plan';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';

type Json = Parameters<(typeof db)['json']>[0];

export async function getLatestNursingAssessment(id: string) {
  return db<
    { id: string; care_plan: string[] }[]
  >`SELECT id, care_plan FROM clinical.nursing_assessments WHERE admission_id = ${id} ORDER BY assessed_at DESC, id DESC LIMIT 1`.catch(
    rethrowDatabaseError,
  );
}

export async function listCarePlanItems(id: string) {
  return db<
    Item[]
  >`SELECT * FROM clinical.nursing_care_plan_items WHERE admission_id = ${id} ORDER BY created_at DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function createCarePlanItem(body: CreateBodyInput, actor_user_id: string, id: string) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Item[]>`
      INSERT INTO clinical.nursing_care_plan_items (admission_id, problem, intervention, created_by)
      SELECT id, ${body.problem}, ${body.intervention}, ${actor_user_id} FROM clinical.admissions WHERE id = ${id} AND status = 'active' RETURNING *
    `;
      if (!row) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'create', 'clinical.nursing_care_plan_items', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function getCarePlanItem(id: string) {
  return db<Item[]>`SELECT * FROM clinical.nursing_care_plan_items WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function updateCarePlanItem(body: UpdateBodyInput, actor_user_id: string, id: string) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Item[]>`
      UPDATE clinical.nursing_care_plan_items item
      SET intervention = COALESCE(${body.intervention ?? null}, item.intervention), status = COALESCE(${body.status ?? null}, item.status),
          resolution_reason = ${body.resolution_reason ?? null}, revision = item.revision + 1, updated_by = ${actor_user_id}, updated_at = now()
      FROM clinical.admissions a
      WHERE item.id = ${id} AND a.id = item.admission_id AND a.status = 'active'
        AND item.status = 'active' AND item.revision = ${body.expected_revision} RETURNING item.*
    `;
      if (!row) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'update', 'clinical.nursing_care_plan_items', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}
