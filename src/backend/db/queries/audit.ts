import { db } from '../index';

type Json = Parameters<(typeof db)['json']>[0];

export async function auditLog(data: {
  actor_user_id?: string;
  action: string;
  record_table: string;
  record_id: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await db`
    INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, before, after)
    VALUES (
      ${data.actor_user_id ?? null},
      ${data.action},
      ${data.record_table},
      ${data.record_id},
      ${data.before != null ? db.json(data.before as unknown as Json) : null},
      ${data.after != null ? db.json(data.after as unknown as Json) : null}
    )
  `;
}
