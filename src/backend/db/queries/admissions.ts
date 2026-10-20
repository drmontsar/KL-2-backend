import { db } from '../index';
import { auditLog } from './audit';

export type Admission = {
  id: string;
  patient_id: string;
  status: 'active' | 'discharged';
  severity: 'unstable' | 'watcher' | 'stable';
  ward: string | null;
  bed: string | null;
  admitted_at: Date;
  discharged_at: Date | null;
  assigned_to: string | null;
  assigned_doctor_id: string | null;
  exit_type: 'discharged' | 'transfer_team' | 'transfer_out' | 'lama' | 'died' | null;
  exit_dest: string | null;
  exit_note: string | null;
  revision: number;
  created_by: string | null;
};

type UserCtx = { id: string; role: string };

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
    ORDER BY a.ward,
             CASE a.severity WHEN 'unstable' THEN 0 WHEN 'watcher' THEN 1 ELSE 2 END,
             a.admitted_at
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
  id: string,
  exit?: { exit_type: Admission['exit_type']; exit_dest?: string; exit_note?: string }
): Promise<Admission | null> {
  const [row] = await db<Admission[]>`
    UPDATE clinical.admissions
    SET status        = 'discharged',
        discharged_at = now(),
        exit_type     = ${exit?.exit_type ?? 'discharged'},
        exit_dest     = ${exit?.exit_dest ?? null},
        exit_note     = ${exit?.exit_note ?? null},
        revision      = revision + 1
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
  data: { ward?: string; bed?: string; severity?: Admission['severity'] },
  expected_revision: number
): Promise<Admission | null | 'conflict'> {
  const [row] = await db<Admission[]>`
    UPDATE clinical.admissions
    SET
      ward     = COALESCE(${data.ward ?? null}, ward),
      bed      = COALESCE(${data.bed ?? null}, bed),
      severity = COALESCE(${data.severity ?? null}, severity),
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

// Returns admission only if the requesting user is allowed to see it:
// doctor → their own (assigned_doctor_id = user.id) or open (NULL)
// nurse  → assigned to them (assigned_to = user.id)
// admin  → any
export async function getAdmissionForUser(
  id: string,
  user: UserCtx
): Promise<Admission | null> {
  if (user.role === 'doctor') {
    const [row] = await db<Admission[]>`
      SELECT * FROM clinical.admissions
      WHERE id = ${id}
        AND (assigned_doctor_id IS NULL OR assigned_doctor_id = ${user.id})
    `;
    return row ?? null;
  }
  if (user.role === 'nurse') {
    const [row] = await db<Admission[]>`
      SELECT * FROM clinical.admissions
      WHERE id = ${id} AND assigned_to = ${user.id}
    `;
    return row ?? null;
  }
  return getAdmissionById(id);
}

type ActiveAdmissionRow = Admission & { patient_name: string; patient_dob: string };

const SEVERITY_ORDER = db`CASE a.severity WHEN 'unstable' THEN 0 WHEN 'watcher' THEN 1 ELSE 2 END`;

// Scoped active admission list — scope drives doctor/nurse filtering
export function listAdmissionsForUser(
  user: UserCtx,
  opts?: { scope?: 'mine' | 'open'; ward?: string }
): Promise<ActiveAdmissionRow[]> {
  const { scope, ward } = opts ?? {};
  const base = db`
    SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
    FROM clinical.admissions a
    JOIN clinical.patients p ON p.id = a.patient_id
    WHERE a.status = 'active'
  `;

  if (user.role === 'doctor' && scope === 'mine') {
    if (ward) {
      return db<ActiveAdmissionRow[]>`
        ${base} AND a.assigned_doctor_id = ${user.id} AND a.ward = ${ward}
        ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
      `;
    }
    return db<ActiveAdmissionRow[]>`
      ${base} AND a.assigned_doctor_id = ${user.id}
      ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
    `;
  }

  if (scope === 'open') {
    if (ward) {
      return db<ActiveAdmissionRow[]>`
        ${base} AND a.assigned_doctor_id IS NULL AND a.ward = ${ward}
        ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
      `;
    }
    return db<ActiveAdmissionRow[]>`
      ${base} AND a.assigned_doctor_id IS NULL
      ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
    `;
  }

  // nurse scope: their assigned admissions
  if (user.role === 'nurse') {
    if (ward) {
      return db<ActiveAdmissionRow[]>`
        ${base} AND a.assigned_to = ${user.id} AND a.ward = ${ward}
        ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
      `;
    }
    return db<ActiveAdmissionRow[]>`
      ${base} AND a.assigned_to = ${user.id}
      ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
    `;
  }

  // admin / no scope — full list (legacy behaviour)
  return listActiveAdmissions(ward ? { ward } : undefined);
}

// Transfer: moves admission from current doctor to another, respecting revision
// Returns 'not_owner' if the admission isn't assigned to from_doctor_id
// Returns 'conflict'  if the revision doesn't match
// Returns 'bad_target' if to_doctor_id isn't an active doctor
export async function transferAdmission(
  id: string,
  from_doctor_id: string,
  to_doctor_id: string,
  expected_revision: number
): Promise<Admission | null | 'not_owner' | 'conflict' | 'bad_target'> {
  const [target] = await db`
    SELECT id FROM staff.users
    WHERE id = ${to_doctor_id} AND role = 'doctor' AND disabled_at IS NULL
  `;
  if (!target) return 'bad_target';

  const [row] = await db<Admission[]>`
    UPDATE clinical.admissions
    SET assigned_doctor_id = ${to_doctor_id}, revision = revision + 1
    WHERE id = ${id}
      AND status = 'active'
      AND assigned_doctor_id = ${from_doctor_id}
      AND revision = ${expected_revision}
    RETURNING *
  `;
  if (row) {
    await auditLog({
      action: 'transfer',
      record_table: 'clinical.admissions',
      record_id: id,
      actor_user_id: from_doctor_id,
      after: row,
    });
    return row;
  }
  const [adm] = await db`
    SELECT assigned_doctor_id, revision FROM clinical.admissions
    WHERE id = ${id} AND status = 'active'
  `;
  if (!adm) return null;
  if (adm.assigned_doctor_id !== from_doctor_id) return 'not_owner';
  return 'conflict';
}

// Atomic claim: sets assigned_doctor_id only if currently NULL
export async function claimAdmission(
  id: string,
  doctor_id: string
): Promise<Admission | null | 'already_claimed'> {
  const [row] = await db<Admission[]>`
    UPDATE clinical.admissions
    SET assigned_doctor_id = ${doctor_id}, revision = revision + 1
    WHERE id = ${id} AND status = 'active' AND assigned_doctor_id IS NULL
    RETURNING *
  `;
  if (row) {
    await auditLog({
      action: 'claim',
      record_table: 'clinical.admissions',
      record_id: id,
      actor_user_id: doctor_id,
      after: row,
    });
    return row;
  }
  const [exists] = await db`
    SELECT assigned_doctor_id FROM clinical.admissions
    WHERE id = ${id} AND status = 'active'
  `;
  if (!exists) return null;
  return exists.assigned_doctor_id ? 'already_claimed' : null;
}
