import { db } from '../index';
import { auditLog } from './audit';

export type Admission = {
  id: string;
  patient_id: string;
  status: 'active' | 'discharged';
  ward: string | null;
  bed: string | null;
  admitted_at: Date;
  discharged_at: Date | null;
  assigned_to: string | null;
  revision: number;
  created_by: string | null;
};

export async function createAdmission(data: {
  patient_id: string;
  ward?: string;
  bed?: string;
  created_by?: string;
}): Promise<Admission> {
  const [row] = await db<Admission[]>`
    INSERT INTO clinical.admissions (patient_id, ward, bed, created_by)
    VALUES (${data.patient_id}, ${data.ward ?? null}, ${data.bed ?? null}, ${data.created_by ?? null})
    RETURNING *
  `;
  await auditLog({
    action: 'create',
    record_table: 'clinical.admissions',
    record_id: row.id,
    actor_user_id: data.created_by,
    after: row,
  });
  return row;
}

export async function getAdmissionById(id: string): Promise<Admission | null> {
  const [row] = await db<Admission[]>`
    SELECT * FROM clinical.admissions WHERE id = ${id}
  `;
  return row ?? null;
}

export function listActiveAdmissions(opts?: {
  ward?: string;
  assigned_to?: string;
}): Promise<(Admission & { patient_name: string; patient_dob: string })[]> {
  const { ward, assigned_to } = opts ?? {};
  if (ward && assigned_to) {
    return db`
      SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE a.status = 'active' AND a.ward = ${ward} AND a.assigned_to = ${assigned_to}
      ORDER BY a.admitted_at
    `;
  }
  if (ward) {
    return db`
      SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE a.status = 'active' AND a.ward = ${ward}
      ORDER BY a.admitted_at
    `;
  }
  if (assigned_to) {
    return db`
      SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE a.status = 'active' AND a.assigned_to = ${assigned_to}
      ORDER BY a.admitted_at
    `;
  }
  return db`
    SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
    FROM clinical.admissions a
    JOIN clinical.patients p ON p.id = a.patient_id
    WHERE a.status = 'active'
    ORDER BY a.ward, a.admitted_at
  `;
}

export function listAdmissionsByPatient(
  patient_id: string
): Promise<Admission[]> {
  return db<Admission[]>`
    SELECT * FROM clinical.admissions
    WHERE patient_id = ${patient_id}
    ORDER BY admitted_at DESC
  `;
}

export async function dischargeAdmission(
  id: string
): Promise<Admission | null> {
  const [row] = await db<Admission[]>`
    UPDATE clinical.admissions
    SET status = 'discharged', discharged_at = now(), revision = revision + 1
    WHERE id = ${id} AND status = 'active'
    RETURNING *
  `;
  if (row) {
    await auditLog({
      action: 'discharge',
      record_table: 'clinical.admissions',
      record_id: id,
      after: row,
    });
  }
  return row ?? null;
}

export async function assignAdmission(
  id: string,
  nurse_id: string
): Promise<Admission | null> {
  const [row] = await db<Admission[]>`
    UPDATE clinical.admissions
    SET assigned_to = ${nurse_id}, revision = revision + 1
    WHERE id = ${id} AND status = 'active'
    RETURNING *
  `;
  if (row) {
    await auditLog({
      action: 'assign',
      record_table: 'clinical.admissions',
      record_id: id,
      actor_user_id: nurse_id,
      after: row,
    });
  }
  return row ?? null;
}

export async function unassignAdmission(id: string): Promise<Admission | null> {
  const [row] = await db<Admission[]>`
    UPDATE clinical.admissions
    SET assigned_to = NULL, revision = revision + 1
    WHERE id = ${id} AND status = 'active'
    RETURNING *
  `;
  if (row) {
    await auditLog({
      action: 'unassign',
      record_table: 'clinical.admissions',
      record_id: id,
      after: row,
    });
  }
  return row ?? null;
}

export async function updateAdmission(
  id: string,
  data: { ward?: string; bed?: string },
  expected_revision: number
): Promise<Admission | null | 'conflict'> {
  const [row] = await db<Admission[]>`
    UPDATE clinical.admissions
    SET
      ward     = COALESCE(${data.ward ?? null}, ward),
      bed      = COALESCE(${data.bed ?? null}, bed),
      revision = revision + 1
    WHERE id = ${id} AND status = 'active' AND revision = ${expected_revision}
    RETURNING *
  `;
  if (!row) {
    const [exists] =
      await db`SELECT 1 FROM clinical.admissions WHERE id = ${id}`;
    return exists ? 'conflict' : null;
  }
  await auditLog({
    action: 'update',
    record_table: 'clinical.admissions',
    record_id: id,
    after: row,
  });
  return row;
}
