import type { TransactionSql } from 'postgres';
import { rethrowDatabaseError } from '../errors';
import { DomainError } from '../../errors';
import { db } from '../index';
import { auditLog } from './audit';

type Json = Parameters<(typeof db)['json']>[0];

async function lockActiveAdmission(tx: TransactionSql, admission_id: string) {
  const [admission] =
    await tx`SELECT id FROM clinical.admissions WHERE id = ${admission_id} AND status = 'active' FOR UPDATE`;
  if (!admission) throw new DomainError('inactive_admission');
}

async function lockOrderAdmission(tx: TransactionSql, order_id: string) {
  const [order] = await tx<
    { admission_id: string }[]
  >`SELECT admission_id FROM clinical.orders WHERE id = ${order_id}`;
  if (!order) return false;
  await lockActiveAdmission(tx, order.admission_id);
  return true;
}

export type Order = {
  id: string;
  admission_id: string;
  kind:
    | 'medication'
    | 'investigation'
    | 'nursing'
    | 'laboratory'
    | 'imaging'
    | 'respiratory'
    | 'diet'
    | 'clinical';
  payload: Record<string, unknown>;
  priority: 'routine' | 'urgent' | 'stat';
  status: 'draft' | 'confirmed' | 'cancelled' | 'completed' | 'discontinued';
  revision: number;
  created_by: string;
  created_at: Date;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  closed_by: string | null;
  closed_at: Date | null;
  close_reason: string | null;
  order_set_item_id: string | null;
  cross_referral_id: string | null;
  consultant_round_id: string | null;
  requires_approval: boolean;
  approval_status: 'not_required' | 'pending' | 'approved' | 'rejected';
  approval_by: string | null;
  approval_at: Date | null;
  approval_reason: string | null;
};

export type Task = {
  id: string;
  order_id: string;
  admission_id: string;
  due_at: Date | null;
  status: 'pending' | 'done' | 'cancelled';
  completed_by: string | null;
  completed_at: Date | null;
  revision: number;
  created_at: Date;
  // joined from parent order
  order_kind: Order['kind'];
  order_payload: Record<string, unknown>;
};

export async function createOrder(data: {
  admission_id: string;
  kind: Order['kind'];
  payload: Record<string, unknown>;
  priority?: Order['priority'];
  requires_approval?: boolean;
  created_by: string;
}): Promise<Order> {
  return db
    .begin(async (tx) => {
      await lockActiveAdmission(tx, data.admission_id);
      const [row] = await tx<Order[]>`
      INSERT INTO clinical.orders (admission_id, kind, payload, priority, created_by, requires_approval, approval_status)
      VALUES (${data.admission_id}, ${data.kind}, ${tx.json(data.payload as unknown as Json)}, ${data.priority ?? 'routine'}, ${data.created_by}, ${data.requires_approval ?? false}, ${data.requires_approval ? 'pending' : 'not_required'})
      RETURNING *
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.created_by}, 'create', 'clinical.orders', ${row.id}, ${tx.json(row as unknown as Json)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export function listOrdersByAdmission(
  admission_id: string,
  status?: Order['status'],
): Promise<Order[]> {
  if (status) {
    return db<Order[]>`
      SELECT * FROM clinical.orders
      WHERE admission_id = ${admission_id} AND status = ${status}
      ORDER BY created_at DESC
    `;
  }
  return db<Order[]>`
    SELECT * FROM clinical.orders
    WHERE admission_id = ${admission_id}
    ORDER BY created_at DESC
  `;
}

// Confirming an order creates its task in one transaction
export async function confirmOrder(data: {
  order_id: string;
  confirmed_by: string;
  due_at?: Date;
}): Promise<{ order: Order; task: Task } | null> {
  return db
    .begin(async (tx) => {
      if (!(await lockOrderAdmission(tx, data.order_id))) return null;
      const [confirmedOrder] = await tx<Order[]>`
      UPDATE clinical.orders
      SET
        status       = 'confirmed',
        confirmed_by = ${data.confirmed_by},
        confirmed_at = now(),
        revision     = revision + 1
      WHERE id = ${data.order_id} AND status = 'draft'
        AND approval_status IN ('not_required', 'approved')
      RETURNING *
    `;

      if (!confirmedOrder) return null;

      const [createdTask] = await tx<Task[]>`
      INSERT INTO clinical.tasks (order_id, admission_id, due_at)
      VALUES (${confirmedOrder.id}, ${confirmedOrder.admission_id}, ${data.due_at ?? null})
      RETURNING *
    `;

      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.confirmed_by}, 'confirm', 'clinical.orders', ${confirmedOrder.id}, ${tx.json(confirmedOrder as unknown as Json)})
    `;
      return {
        order: confirmedOrder,
        task: {
          ...createdTask,
          order_kind: confirmedOrder.kind,
          order_payload: confirmedOrder.payload,
        },
      };
    })
    .catch(rethrowDatabaseError);
}

export async function decideOrderApproval(data: {
  id: string;
  user_id: string;
  decision: 'approved' | 'rejected';
  reason: string;
}): Promise<Order | null> {
  return db
    .begin(async (tx) => {
      if (!(await lockOrderAdmission(tx, data.id))) return null;
      const [row] = await tx<Order[]>`
      UPDATE clinical.orders
      SET approval_status = ${data.decision}, approval_by = ${data.user_id}, approval_at = now(),
          approval_reason = ${data.reason}, revision = revision + 1
      WHERE id = ${data.id} AND status = 'draft' AND approval_status = 'pending'
      RETURNING *
    `;
      if (!row) return null;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.user_id}, ${data.decision}, 'clinical.orders', ${data.id}, ${tx.json(row as unknown as Json)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function acknowledgeOrder(id: string, user_id: string): Promise<Order | null> {
  return db
    .begin(async (tx) => {
      if (!(await lockOrderAdmission(tx, id))) return null;
      const [row] = await tx<Order[]>`
      UPDATE clinical.orders
      SET acknowledged_by = ${user_id}, acknowledged_at = now(), revision = revision + 1
      WHERE id = ${id} AND status = 'confirmed' AND acknowledged_at IS NULL
      RETURNING *
    `;
      if (!row) return null;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${user_id}, 'acknowledge', 'clinical.orders', ${row.id}, ${tx.json(row as unknown as Json)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function closeOrder(data: {
  id: string;
  user_id: string;
  status: 'completed' | 'discontinued';
  reason: string;
}): Promise<Order | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Order[]>`
      UPDATE clinical.orders
      SET status = ${data.status}, closed_by = ${data.user_id}, closed_at = now(),
          close_reason = ${data.reason}, revision = revision + 1
      WHERE id = ${data.id} AND status = 'confirmed'
        AND (${data.status} <> 'completed' OR NOT EXISTS (
          SELECT 1 FROM clinical.tasks t WHERE t.order_id = ${data.id} AND t.status = 'pending'
        ))
      RETURNING *
    `;
      if (!row) return null;
      if (data.status === 'discontinued') {
        await tx`
        UPDATE clinical.tasks SET status = 'cancelled', revision = revision + 1
        WHERE order_id = ${data.id} AND status = 'pending'
      `;
      }
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.user_id}, ${data.status}, 'clinical.orders', ${data.id}, ${tx.json(row as unknown as Json)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function cancelOrder(id: string, actor_user_id: string): Promise<Order | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Order[]>`
      UPDATE clinical.orders
      SET status = 'cancelled', revision = revision + 1
      WHERE id = ${id} AND status = 'draft'
      RETURNING *
    `;
      if (row) {
        await auditLog(tx, {
          actor_user_id,
          action: 'cancel',
          record_table: 'clinical.orders',
          record_id: id,
          after: row,
        });
      }
      return row ?? null;
    })
    .catch(rethrowDatabaseError);
}

// Tasks

const TASK_SELECT = db`
  SELECT t.*, o.kind AS order_kind, o.payload AS order_payload
  FROM clinical.tasks t
  JOIN clinical.orders o ON o.id = t.order_id
`;

export function listTasksByAdmission(
  admission_id: string,
  status?: Task['status'],
): Promise<Task[]> {
  if (status) {
    return db<Task[]>`
      ${TASK_SELECT}
      WHERE t.admission_id = ${admission_id} AND t.status = ${status}
      ORDER BY t.due_at NULLS LAST, t.created_at
    `;
  }
  return db<Task[]>`
    ${TASK_SELECT}
    WHERE t.admission_id = ${admission_id}
    ORDER BY t.due_at NULLS LAST, t.created_at
  `;
}

export function listTasksByNurse(nurse_id: string, status?: Task['status']): Promise<Task[]> {
  if (status) {
    return db<Task[]>`
      ${TASK_SELECT}
      JOIN clinical.admissions a ON a.id = t.admission_id
      WHERE a.assigned_to = ${nurse_id} AND t.status = ${status}
      ORDER BY t.due_at NULLS LAST, t.created_at
    `;
  }
  return db<Task[]>`
    ${TASK_SELECT}
    JOIN clinical.admissions a ON a.id = t.admission_id
    WHERE a.assigned_to = ${nurse_id}
    ORDER BY t.due_at NULLS LAST, t.created_at
  `;
}

export async function completeTask(data: {
  task_id: string;
  completed_by: string;
}): Promise<Task | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Task[]>`
      UPDATE clinical.tasks
      SET
        status       = 'done',
        completed_by = ${data.completed_by},
        completed_at = now(),
        revision     = revision + 1
      WHERE id = ${data.task_id} AND status = 'pending'
      RETURNING *
    `;
      if (row) {
        await auditLog(tx, {
          action: 'complete',
          record_table: 'clinical.tasks',
          record_id: data.task_id,
          actor_user_id: data.completed_by,
          after: row,
        });
      }
      return row ?? null;
    })
    .catch(rethrowDatabaseError);
}

export async function cancelTask(id: string, actor_user_id: string): Promise<Task | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Task[]>`
      UPDATE clinical.tasks
      SET status = 'cancelled', revision = revision + 1
      WHERE id = ${id} AND status = 'pending'
      RETURNING *
    `;
      if (row) {
        await auditLog(tx, {
          actor_user_id,
          action: 'cancel',
          record_table: 'clinical.tasks',
          record_id: id,
          after: row,
        });
      }
      return row ?? null;
    })
    .catch(rethrowDatabaseError);
}
