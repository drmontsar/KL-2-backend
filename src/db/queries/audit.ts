import type { TransactionSql } from 'postgres';

type Json = Parameters<TransactionSql['json']>[0];

export async function auditLog(
  tx: TransactionSql,
  data: {
    actor_user_id: string;
    action: string;
    record_table: string;
    record_id: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await tx`
    INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, before, after)
    VALUES (
      ${data.actor_user_id},
      ${data.action},
      ${data.record_table},
      ${data.record_id},
      ${data.before != null ? tx.json(data.before as unknown as Json) : null},
      ${data.after != null ? tx.json(data.after as unknown as Json) : null}
    )
  `;
}
