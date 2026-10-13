import { db } from '../index';
import { auditLog } from './audit';

type Json = Parameters<(typeof db)['json']>[0];

export type Order = {
  id: string;
  admission_id: string;
  kind: 'medication' | 'investigation' | 'nursing';
  payload: Record<string, unknown>;
  status: 'draft' | 'confirmed' | 'cancelled';
  revision: number;
  created_by: string;
  created_at: Date;
  confirmed_by: string | null;
  confirmed_at: Date | null;
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
};

export async function createOrder(data: {
  admission_id: string;
  kind: Order['kind'];
  payload: Record<string, unknown>;
  created_by: string;
}): Promise<Order> {
  const [row] = await db<Order[]>`
    INSERT INTO clinical.orders (admission_id, kind, payload, created_by)
    VALUES (${data.admission_id}, ${data.kind}, ${db.json(data.payload as unknown as Json)}, ${data.created_by})
    RETURNING *
  `;
  return row;
}

export function listOrdersByAdmission(
  admission_id: string,
  status?: Order['status']
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
}): Promise<{ order: Order; task: Task }> {
  const [order, task] = await db.begin(async (tx) => {
    const [confirmedOrder] = await tx<Order[]>`
      UPDATE clinical.orders
      SET
        status       = 'confirmed',
        confirmed_by = ${data.confirmed_by},
        confirmed_at = now(),
        revision     = revision + 1
      WHERE id = ${data.order_id} AND status = 'draft'
      RETURNING *
    `;

    const [createdTask] = await tx<Task[]>`
      INSERT INTO clinical.tasks (order_id, admission_id, due_at)
      VALUES (${confirmedOrder.id}, ${confirmedOrder.admission_id}, ${data.due_at ?? null})
      RETURNING *
    `;

    return [confirmedOrder, createdTask];
  });

  await auditLog({
    action: 'confirm',
    record_table: 'clinical.orders',
    record_id: order.id,
    actor_user_id: data.confirmed_by,
    after: order,
  });
  return { order, task };
}

export async function cancelOrder(id: string): Promise<Order | null> {
  const [row] = await db<Order[]>`
    UPDATE clinical.orders
    SET status = 'cancelled', revision = revision + 1
    WHERE id = ${id} AND status = 'draft'
    RETURNING *
  `;
  if (row) {
    await auditLog({
      action: 'cancel',
      record_table: 'clinical.orders',
      record_id: id,
      after: row,
    });
  }
  return row ?? null;
}

// Tasks

export function listTasksByAdmission(
  admission_id: string,
  status?: Task['status']
): Promise<Task[]> {
  if (status) {
    return db<Task[]>`
      SELECT * FROM clinical.tasks
      WHERE admission_id = ${admission_id} AND status = ${status}
      ORDER BY due_at NULLS LAST, created_at
    `;
  }
  return db<Task[]>`
    SELECT * FROM clinical.tasks
    WHERE admission_id = ${admission_id}
    ORDER BY due_at NULLS LAST, created_at
  `;
}

export async function completeTask(data: {
  task_id: string;
  completed_by: string;
}): Promise<Task | null> {
  const [row] = await db<Task[]>`
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
    await auditLog({
      action: 'complete',
      record_table: 'clinical.tasks',
      record_id: data.task_id,
      actor_user_id: data.completed_by,
      after: row,
    });
  }
  return row ?? null;
}

export async function cancelTask(id: string): Promise<Task | null> {
  const [row] = await db<Task[]>`
    UPDATE clinical.tasks
    SET status = 'cancelled', revision = revision + 1
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
  `;
  if (row) {
    await auditLog({
      action: 'cancel',
      record_table: 'clinical.tasks',
      record_id: id,
      after: row,
    });
  }
  return row ?? null;
}
