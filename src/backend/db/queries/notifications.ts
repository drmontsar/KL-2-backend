import { db } from '../index';

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
};

// Channel name safe for pg LISTEN/NOTIFY (no hyphens, max 63 chars)
export function notifChannel(userId: string) {
  return `u_${userId.replace(/-/g, '')}`;
}

export async function createNotification(data: {
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
}): Promise<Notification> {
  const [row] = await db<Notification[]>`
    INSERT INTO clinical.notifications (user_id, type, payload)
    VALUES (${data.user_id}, ${data.type}, ${db.json(data.payload as never)})
    RETURNING *
  `;
  // Wake any open SSE connection for this user
  await db`SELECT pg_notify(${notifChannel(data.user_id)}, ${JSON.stringify({ id: row.id, type: row.type, payload: row.payload, created_at: row.created_at })})`;
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
  user_id: string
): Promise<Notification | null> {
  const [row] = await db<Notification[]>`
    UPDATE clinical.notifications
    SET read_at = now()
    WHERE id = ${id} AND user_id = ${user_id} AND read_at IS NULL
    RETURNING *
  `;
  return row ?? null;
}

export async function markAllNotificationsRead(
  user_id: string
): Promise<number> {
  const result = await db`
    UPDATE clinical.notifications
    SET read_at = now()
    WHERE user_id = ${user_id} AND read_at IS NULL
  `;
  return result.count;
}
