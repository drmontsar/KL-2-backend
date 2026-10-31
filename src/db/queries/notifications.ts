import type { TransactionSql } from 'postgres';
import { db } from '../index';

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  read_at: Date | null;
  acknowledged_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
};

// Channel name safe for pg LISTEN/NOTIFY (no hyphens, max 63 chars)
export function notifChannel(userId: string) {
  return `u_${userId.replace(/-/g, '')}`;
}

export async function createNotification(
  data: {
    user_id: string;
    type: string;
    payload: Record<string, unknown>;
  },
  tx: TransactionSql,
): Promise<Notification> {
  const [row] = await tx<Notification[]>`
    INSERT INTO clinical.notifications (user_id, type, payload)
    VALUES (${data.user_id}, ${data.type}, ${tx.json(data.payload as never)})
    RETURNING *
  `;
  // PostgreSQL delivers this small wake-up event only after the transaction commits.
  await tx`SELECT pg_notify(${notifChannel(data.user_id)}, ${JSON.stringify({ id: row.id })})`;
  return row;
}

export function listNotifications(opts: {
  user_id: string;
  unread_only?: boolean;
  limit?: number;
}): Promise<Notification[]> {
  const limit = opts.limit ?? 50;
  if (opts.unread_only) {
    return db<Notification[]>`
      SELECT * FROM clinical.notifications
      WHERE user_id = ${opts.user_id} AND read_at IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
  return db<Notification[]>`
    SELECT * FROM clinical.notifications
    WHERE user_id = ${opts.user_id}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function markNotificationRead(
  id: string,
  user_id: string,
): Promise<Notification | null> {
  const [row] = await db<Notification[]>`
    UPDATE clinical.notifications
    SET read_at = now()
    WHERE id = ${id} AND user_id = ${user_id} AND read_at IS NULL
    RETURNING *
  `;
  return row ?? null;
}

export async function acknowledgeNotification(
  id: string,
  user_id: string,
): Promise<Notification | null> {
  const [row] = await db<Notification[]>`
    UPDATE clinical.notifications
    SET read_at = COALESCE(read_at, now()), acknowledged_at = COALESCE(acknowledged_at, now())
    WHERE id = ${id} AND user_id = ${user_id} AND closed_at IS NULL
    RETURNING *
  `;
  return row ?? null;
}

export async function closeNotification(id: string, user_id: string): Promise<Notification | null> {
  const [row] = await db<Notification[]>`
    UPDATE clinical.notifications
    SET read_at = COALESCE(read_at, now()), closed_at = COALESCE(closed_at, now())
    WHERE id = ${id} AND user_id = ${user_id}
    RETURNING *
  `;
  return row ?? null;
}

export async function markAllNotificationsRead(user_id: string): Promise<number> {
  const result = await db`
    UPDATE clinical.notifications
    SET read_at = now()
    WHERE user_id = ${user_id} AND read_at IS NULL
  `;
  return result.count;
}

export function listenNotifications(userId: string, onEvent: (payload: string) => void) {
  return db.listen(notifChannel(userId), onEvent);
}

export async function getNotificationForUser(id: string, userId: string) {
  const [row] =
    await db`SELECT id, type, payload, created_at FROM clinical.notifications WHERE id = ${id} AND user_id = ${userId}`;
  return row ?? null;
}
