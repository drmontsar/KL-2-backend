import { db } from '../index';
import { DomainError } from '../../errors';
import { hashPassword, verifyPassword } from '../../security/password';
import type { User } from './users';

export async function authenticate(email: string, password: string): Promise<User | null> {
  const [row] = await db<(User & { password_hash: string })[]>`
    SELECT u.*, c.email, c.password_hash FROM staff.user_credentials c
    JOIN staff.users u ON u.id = c.user_id
    WHERE c.email = ${email} AND u.disabled_at IS NULL
  `;
  if (!row || !(await verifyPassword(password, row.password_hash))) return null;
  const { password_hash: _hash, ...user } = row;
  return user;
}

export async function setUserCredentials(userId: string, email: string, password: string, actorId = userId): Promise<User | null> {
  const hash = await hashPassword(password);
  try {
    return await db.begin(async (tx) => {
      const [user] = await tx<User[]>`SELECT * FROM staff.users WHERE id = ${userId} AND disabled_at IS NULL FOR UPDATE`;
      if (!user) return null;
      await tx`
        INSERT INTO staff.user_credentials (user_id, email, password_hash)
        VALUES (${userId}, ${email}, ${hash})
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash, updated_at = now()
      `;
      await tx`DELETE FROM staff.sessions WHERE user_id = ${userId}`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
        VALUES (${actorId}, 'set_credentials', 'staff.users', ${userId}, ${tx.json({ email })})`;
      return { ...user, email };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new DomainError('conflict');
    throw error;
  }
}

export async function changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<boolean> {
  const hash = await hashPassword(nextPassword);
  return db.begin(async (tx) => {
    const [credentials] = await tx<{ password_hash: string }[]>`
      SELECT password_hash FROM staff.user_credentials WHERE user_id = ${userId} FOR UPDATE
    `;
    if (!credentials || !(await verifyPassword(currentPassword, credentials.password_hash))) return false;
    await tx`UPDATE staff.user_credentials SET password_hash = ${hash}, updated_at = now() WHERE user_id = ${userId}`;
    await tx`DELETE FROM staff.sessions WHERE user_id = ${userId}`;
    return true;
  });
}

export async function createSession(userId: string, shift?: 'morning' | 'afternoon' | 'night'): Promise<string> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  await db`
    INSERT INTO staff.sessions (user_id, token, selected_shift)
    VALUES (${userId}, ${token}, ${shift ?? null})
  `;
  return token;
}

export async function resolveSession(token: string): Promise<User | null> {
  const [row] = await db<User[]>`
    SELECT u.*, c.email
    FROM staff.sessions s
    JOIN staff.users u ON u.id = s.user_id
    LEFT JOIN staff.user_credentials c ON c.user_id = u.id
    WHERE s.token = ${token}
      AND s.expires_at > now()
      AND u.disabled_at IS NULL
  `;
  return row ?? null;
}

export async function getSessionShift(token: string) {
  const [session] = await db<{ selected_shift: 'morning' | 'afternoon' | 'night' | null }[]>`
    SELECT selected_shift FROM staff.sessions WHERE token = ${token} AND expires_at > now()
  `;
  return session?.selected_shift ?? null;
}

export async function selectSessionShift(token: string, userId: string, shift: 'morning' | 'afternoon' | 'night') {
  const [session] = await db<{ selected_shift: 'morning' | 'afternoon' | 'night' }[]>`
    UPDATE staff.sessions s SET selected_shift = ${shift}
    FROM staff.users u WHERE s.token = ${token} AND s.user_id = ${userId}
      AND s.expires_at > now() AND u.id = s.user_id AND u.disabled_at IS NULL
      AND ((u.role = 'doctor' AND u.job_role = 'duty_doctor') OR u.role = 'nurse')
    RETURNING s.selected_shift
  `;
  return session ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await db`DELETE FROM staff.sessions WHERE token = ${token}`;
}
