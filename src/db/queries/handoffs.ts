import { db } from '../index';
import { rethrowDatabaseError } from '../errors';
import { DomainError } from '../../errors';
import { auditLog } from './audit';
import { createNotification } from './notifications';

export type Handoff = {
  id: string;
  admission_id: string;
  requested_by: string;
  assigned_to: string;
  reason: string | null;
  readback: string | null;
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
  return db
    .begin(async (tx) => {
      const [admission] =
        await tx`SELECT id FROM clinical.admissions WHERE id = ${data.admission_id} AND status = 'active' AND assigned_to = ${data.assigned_to} FOR UPDATE`;
      if (!admission) throw new DomainError('conflict');
      const [row] = await tx<Handoff[]>`
      INSERT INTO clinical.handoffs (admission_id, requested_by, assigned_to, reason)
      VALUES (${data.admission_id}, ${data.requested_by}, ${data.assigned_to}, ${data.reason ?? null})
      RETURNING *
    `;
      await auditLog(tx, {
        action: 'create',
        record_table: 'clinical.handoffs',
        record_id: row.id,
        actor_user_id: data.requested_by,
        after: row,
      });
      await createNotification(
        {
          user_id: row.assigned_to,
          type: 'handoff.created',
          payload: { handoff_id: row.id, admission_id: row.admission_id, reason: row.reason },
        },
        tx,
      );
      return row;
    })
    .catch(rethrowDatabaseError);
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
  acknowledged_by: string,
  readback?: string,
): Promise<Handoff | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Handoff[]>`
      UPDATE clinical.handoffs
      SET
        status          = 'acknowledged',
        acknowledged_by = ${acknowledged_by},
        acknowledged_at = now(),
        readback        = ${readback ?? null}
      WHERE id = ${id} AND status = 'pending' AND assigned_to = ${acknowledged_by}
      RETURNING *
    `;
      if (row) {
        await createNotification(
          {
            user_id: row.requested_by,
            type: 'handoff.acknowledged',
            payload: { handoff_id: row.id, admission_id: row.admission_id, acknowledged_by },
          },
          tx,
        );
        await auditLog(tx, {
          action: 'acknowledge',
          record_table: 'clinical.handoffs',
          record_id: id,
          actor_user_id: acknowledged_by,
          after: row,
        });
      }
      return row ?? null;
    })
    .catch(rethrowDatabaseError);
}

export async function doneHandoff(id: string, completed_by: string): Promise<Handoff | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Handoff[]>`
      UPDATE clinical.handoffs
      SET status = 'done', done_at = now()
      WHERE id = ${id}
        AND status IN ('pending', 'acknowledged')
        AND (requested_by = ${completed_by} OR assigned_to = ${completed_by})
      RETURNING *
    `;
      if (row) {
        await createNotification(
          {
            user_id: row.requested_by,
            type: 'handoff.done',
            payload: { handoff_id: row.id, admission_id: row.admission_id },
          },
          tx,
        );
        await auditLog(tx, {
          action: 'done',
          record_table: 'clinical.handoffs',
          record_id: id,
          actor_user_id: completed_by,
          after: row,
        });
      }
      return row ?? null;
    })
    .catch(rethrowDatabaseError);
}
