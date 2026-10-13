import { db } from '../index';

export type User = {
  id: string;
  name: string;
  role: 'doctor' | 'nurse' | 'admin';
  registration_number: string | null;
  specialization: string | null;
  phone: string | null;
  created_at: Date;
  disabled_at: Date | null;
};

export async function createUser(data: {
  name: string;
  role: User['role'];
  registration_number?: string;
  specialization?: string;
  phone?: string;
}): Promise<User> {
  const [row] = await db<User[]>`
    INSERT INTO staff.users (name, role, registration_number, specialization, phone)
    VALUES (
      ${data.name},
      ${data.role},
      ${data.registration_number ?? null},
      ${data.specialization ?? null},
      ${data.phone ?? null}
    )
    RETURNING *
  `;
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
