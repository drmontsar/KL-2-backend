import { DomainError } from '../../errors';
import { db } from '../index';

export type User = {
  id: string;
  name: string;
  role: 'doctor' | 'nurse' | 'admin';
  job_role:
    | 'duty_doctor'
    | 'consultant'
    | 'staff_nurse'
    | 'pharmacist'
    | 'billing_insurance'
    | 'bed_desk'
    | 'administrator';
  registration_number: string | null;
  specialization: string | null;
  phone: string | null;
  current_area: string | null;
  last_seen_at: Date | null;
  created_at: Date;
  disabled_at: Date | null;
};

export type DoctorPresence = User & { online: boolean };

export async function createUser(data: {
  name: string;
  role: User['role'];
  job_role?: User['job_role'];
  registration_number?: string;
  specialization?: string;
  phone: string;
}): Promise<User> {
  let row: User;
  try {
    [row] = await db<User[]>`
    INSERT INTO staff.users (name, role, job_role, registration_number, specialization, phone)
    VALUES (
      ${data.name},
      ${data.role},
      ${data.job_role ?? (data.role === 'doctor' ? 'duty_doctor' : data.role === 'nurse' ? 'staff_nurse' : 'administrator')},
      ${data.registration_number ?? null},
      ${data.specialization ?? null},
      ${data.phone ?? null}
    )
    RETURNING *
  `;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new DomainError('conflict');
    throw error;
  }
  return row;
}

export async function getUserById(id: string): Promise<User | null> {
  const [row] = await db<User[]>`
    SELECT * FROM staff.users WHERE id = ${id}
  `;
  return row ?? null;
}

export function listUsers(role?: User['role']): Promise<User[]> {
  if (role) {
    return db<User[]>`
      SELECT * FROM staff.users
      WHERE role = ${role} AND disabled_at IS NULL
      ORDER BY name
    `;
  }
  return db<User[]>`
    SELECT * FROM staff.users WHERE disabled_at IS NULL ORDER BY name
  `;
}

export async function disableUser(id: string): Promise<void> {
  await db`UPDATE staff.users SET disabled_at = now() WHERE id = ${id}`;
}

export function touchLastSeen(id: string): void {
  db`UPDATE staff.users SET last_seen_at = now() WHERE id = ${id}`.catch(() => {});
}

export async function setDoctorArea(id: string, area: string | null): Promise<User | null> {
  const [row] = await db<User[]>`
    UPDATE staff.users SET current_area = ${area}
    WHERE id = ${id} AND role = 'doctor' AND disabled_at IS NULL
    RETURNING *
  `;
  return row ?? null;
}

export async function listActiveDoctors(): Promise<DoctorPresence[]> {
  const rows = await db<(User & { online: boolean })[]>`
    SELECT *,
      (last_seen_at > now() - interval '5 minutes') AS online
    FROM staff.users
    WHERE role = 'doctor' AND disabled_at IS NULL AND current_area IS NOT NULL
    ORDER BY name
  `;
  return rows;
}
