import { db } from '../index';
import { admissionAccessFilter, getAdmissionForUser } from './admissions';
import type { User } from './users';

export function canAccessAdmission(user: User, admissionId: string): Promise<boolean> {
  return getAdmissionForUser(admissionId, user).then(Boolean);
}

// The fragment is used with the clinical.patients alias `p`.
export function patientAccessFilter(user: User) {
  if (user.job_role === 'administrator') return db`TRUE`;
  return db`(
    (${user.role === 'doctor' || user.job_role === 'bed_desk'} AND p.created_by = ${user.id}
      AND NOT EXISTS (SELECT 1 FROM clinical.admissions own_admission WHERE own_admission.patient_id = p.id))
    OR EXISTS (
      SELECT 1 FROM clinical.admissions a WHERE a.patient_id = p.id AND (
        ${admissionAccessFilter(user)}
        OR (${user.job_role === 'bed_desk'} AND EXISTS (
          SELECT 1 FROM staff.unit_memberships m WHERE m.user_id = ${user.id} AND m.unit_id = a.unit_id
        ))
      )
    )
  )`;
}

export async function canAccessPatient(user: User, patientId: string): Promise<boolean> {
  const [row] =
    await db`SELECT 1 FROM clinical.patients p WHERE p.id = ${patientId} AND ${patientAccessFilter(user)}`;
  return Boolean(row);
}

export type AdmissionResource =
  | 'note'
  | 'note_version'
  | 'order'
  | 'task'
  | 'diagnosis'
  | 'handoff';

async function resourceAdmissionId(type: AdmissionResource, id: string): Promise<string | null> {
  let rows: { admission_id: string | null }[];
  switch (type) {
    case 'note':
      rows = await db`SELECT admission_id FROM clinical.notes WHERE id = ${id}`;
      break;
    case 'note_version':
      rows = await db`
        SELECT n.admission_id
        FROM clinical.note_versions v
        JOIN clinical.notes n ON n.id = v.note_id
        WHERE v.id = ${id}
      `;
      break;
    case 'order':
      rows = await db`SELECT admission_id FROM clinical.orders WHERE id = ${id}`;
      break;
    case 'task':
      rows = await db`SELECT admission_id FROM clinical.tasks WHERE id = ${id}`;
      break;
    case 'diagnosis':
      rows = await db`SELECT admission_id FROM clinical.diagnoses WHERE id = ${id}`;
      break;
    case 'handoff':
      rows = await db`SELECT admission_id FROM clinical.handoffs WHERE id = ${id}`;
      break;
  }
  return rows[0]?.admission_id ?? null;
}

export async function canAccessResource(
  user: User,
  type: AdmissionResource,
  id: string,
): Promise<boolean> {
  const admissionId = await resourceAdmissionId(type, id);
  return admissionId ? canAccessAdmission(user, admissionId) : user.job_role === 'administrator';
}
