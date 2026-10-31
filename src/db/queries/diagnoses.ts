import { db } from '../index';
import { rethrowDatabaseError } from '../errors';
import { auditLog } from './audit';

export type Diagnosis = {
  id: string;
  patient_id: string;
  admission_id: string | null;
  description: string;
  status: 'active' | 'resolved';
  diagnosed_at: Date;
  resolved_at: Date | null;
  created_by: string;
  created_at: Date;
};

export async function createDiagnosis(data: {
  patient_id: string;
  admission_id?: string;
  description: string;
  created_by: string;
}): Promise<Diagnosis> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Diagnosis[]>`
      INSERT INTO clinical.diagnoses (patient_id, admission_id, description, created_by)
      VALUES (${data.patient_id}, ${data.admission_id ?? null}, ${data.description}, ${data.created_by})
      RETURNING *
    `;
      await auditLog(tx, {
        action: 'create',
        record_table: 'clinical.diagnoses',
        record_id: row.id,
        actor_user_id: data.created_by,
        after: row,
      });
      return row;
    })
    .catch(rethrowDatabaseError);
}

export function listDiagnoses(
  patient_id: string,
  status?: Diagnosis['status'],
): Promise<Diagnosis[]> {
  if (status) {
    return db<Diagnosis[]>`
      SELECT * FROM clinical.diagnoses
      WHERE patient_id = ${patient_id} AND status = ${status}
      ORDER BY diagnosed_at DESC
    `;
  }
  return db<Diagnosis[]>`
    SELECT * FROM clinical.diagnoses
    WHERE patient_id = ${patient_id}
    ORDER BY diagnosed_at DESC
  `;
}

export async function resolveDiagnosis(
  id: string,
  actor_user_id: string,
): Promise<Diagnosis | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Diagnosis[]>`
      UPDATE clinical.diagnoses
      SET status = 'resolved', resolved_at = now()
      WHERE id = ${id} AND status = 'active'
      RETURNING *
    `;
      if (row) {
        await auditLog(tx, {
          actor_user_id,
          action: 'resolve',
          record_table: 'clinical.diagnoses',
          record_id: id,
          after: row,
        });
      }
      return row ?? null;
    })
    .catch(rethrowDatabaseError);
}

export async function reopenDiagnosis(
  id: string,
  actor_user_id: string,
): Promise<Diagnosis | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Diagnosis[]>`
      UPDATE clinical.diagnoses
      SET status = 'active', resolved_at = NULL
      WHERE id = ${id} AND status = 'resolved'
      RETURNING *
    `;
      if (row) {
        await auditLog(tx, {
          actor_user_id,
          action: 'reopen',
          record_table: 'clinical.diagnoses',
          record_id: id,
          after: row,
        });
      }
      return row ?? null;
    })
    .catch(rethrowDatabaseError);
}
