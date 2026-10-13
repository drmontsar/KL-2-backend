import { db } from '../index';
import { auditLog } from './audit';

export type Handoff = {
  id: string;
  admission_id: string;
  requested_by: string;
  assigned_to: string;
  reason: string | null;
  status: 'pending' | 'acknowledged' | 'done';
  requested_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  done_at: Date | null;
};

export async function createHandoff(data: {
  admission_id: string;
  requested_by: string;
  assigned_to: string;
  reason?: string;
}): Promise<Handoff> {
  const [row] = await db<Handoff[]>`
    INSERT INTO clinical.handoffs (admission_id, requested_by, assigned_to, reason)
    VALUES (${data.admission_id}, ${data.requested_by}, ${data.assigned_to}, ${data.reason ?? null})
    RETURNING *
  `;
  await auditLog({
    action: 'create',
    record_table: 'clinical.handoffs',
    record_id: row.id,
    actor_user_id: data.requested_by,
    after: row,
  });
  return row;
}

export function listHandoffs(opts: {
  nurse_id: string;
  status?: Handoff['status'];
}): Promise<Handoff[]> {
  if (opts.status) {
    return db<Handoff[]>`
      SELECT * FROM clinical.handoffs
      WHERE assigned_to = ${opts.nurse_id} AND status = ${opts.status}
      ORDER BY requested_at DESC
    `;
  }
  return db<Handoff[]>`
    SELECT * FROM clinical.handoffs
    WHERE assigned_to = ${opts.nurse_id}
    ORDER BY requested_at DESC
  `;
}

export async function acknowledgeHandoff(
  id: string,
  acknowledged_by: string
): Promise<Handoff | null> {
  const [row] = await db<Handoff[]>`
    UPDATE clinical.handoffs
    SET
      status          = 'acknowledged',
      acknowledged_by = ${acknowledged_by},
      acknowledged_at = now()
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
  `;
  if (row) {
    await auditLog({
      action: 'acknowledge',
      record_table: 'clinical.handoffs',
      record_id: id,
      actor_user_id: acknowledged_by,
      after: row,
    });
  }
  return row ?? null;
}

export async function doneHandoff(id: string): Promise<Handoff | null> {
  const [row] = await db<Handoff[]>`
    UPDATE clinical.handoffs
    SET status = 'done', done_at = now()
    WHERE id = ${id} AND status IN ('pending', 'acknowledged')
    RETURNING *
  `;
  if (row) {
    await auditLog({
      action: 'done',
      record_table: 'clinical.handoffs',
      record_id: id,
      after: row,
    });
  }
  return row ?? null;
}
