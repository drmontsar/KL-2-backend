import { db } from '../index';
import type { User } from './users';

export async function getUserByPhone(phone: string): Promise<User | null> {
  const [row] = await db<User[]>`
    SELECT * FROM staff.users
    WHERE phone = ${phone} AND disabled_at IS NULL
  `;
  return row ?? null;
}

export async function createSession(userId: string): Promise<string> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  await db`
    INSERT INTO staff.sessions (user_id, token)
    VALUES (${userId}, ${token})
  `;
  return token;
}

export async function resolveSession(token: string): Promise<User | null> {
  const [row] = await db<User[]>`
    SELECT u.*
    FROM staff.sessions s
    JOIN staff.users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > now()
      AND u.disabled_at IS NULL
  `;
  return row ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await db`DELETE FROM staff.sessions WHERE token = ${token}`;
}
