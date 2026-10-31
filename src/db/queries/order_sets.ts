import { createHash } from 'node:crypto';
import { ApplyBodyInput, SetBodyInput } from '../../contracts/order_sets';

type SetRow = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_by: string;
  created_at: Date;
};

type ItemRow = {
  id: string;
  order_set_id: string;
  position: number;
  kind: Order['kind'];
  priority: Order['priority'];
  payload: Record<string, unknown>;
};
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import type { Order } from './orders';

type Json = Parameters<(typeof db)['json']>[0];

export async function listOrderSets() {
  return db<SetRow[]>`SELECT * FROM clinical.order_sets WHERE active ORDER BY name`.catch(
    rethrowDatabaseError,
  );
}

export async function listOrderSetItems(ids: string[]) {
  return db<
    ItemRow[]
  >`SELECT * FROM clinical.order_set_items WHERE order_set_id IN ${db(ids)} ORDER BY position`.catch(
    rethrowDatabaseError,
  );
}

export async function createOrderSet(body: SetBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [set] = await tx<SetRow[]>`
          INSERT INTO clinical.order_sets (name, description, created_by)
          VALUES (${body.name}, ${body.description ?? null}, ${actor_user_id}) RETURNING *
        `;
      const items: ItemRow[] = [];
      for (const [position, item] of body.items.entries()) {
        const [row] = await tx<ItemRow[]>`
            INSERT INTO clinical.order_set_items (order_set_id, position, kind, priority, payload)
            VALUES (${set.id}, ${position}, ${item.kind}, ${item.priority}, ${tx.json(item.payload as Json)}) RETURNING *
          `;
        items.push(row);
      }
      await tx`
          INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
          VALUES (${actor_user_id}, 'create', 'clinical.order_sets', ${set.id}, ${tx.json({ ...set, created_at: set.created_at.toISOString(), items } as unknown as Json)})
        `;
      return { ...set, created_at: set.created_at.toISOString(), items };
    })
    .catch(rethrowDatabaseError);
}

export async function applyOrderSet(
  actor_user_id: string,
  key: string,
  body: ApplyBodyInput,
  id: string,
) {
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({ id, admission_id: body.admission_id, item_ids: [...body.item_ids].sort() }),
    )
    .digest('hex');
  return db
    .begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor_user_id}:order-set:${key}`}, 0))`;
      const [previous] = await tx<{ request_hash: string; order_ids: string[] }[]>`
        SELECT request_hash, order_ids FROM clinical.order_set_applications
        WHERE actor_user_id = ${actor_user_id} AND idempotency_key = ${key}
      `;
      if (previous) {
        if (previous.request_hash !== requestHash) return null;
        return tx<Order[]>`
          SELECT * FROM clinical.orders WHERE id IN ${tx(previous.order_ids)}
          ORDER BY array_position(${previous.order_ids}::uuid[], id)
        `;
      }
      const [admission] =
        await tx`SELECT id FROM clinical.admissions WHERE id = ${body.admission_id} AND status = 'active' FOR UPDATE`;
      if (!admission) return null;
      const items = await tx<ItemRow[]>`
        SELECT i.* FROM clinical.order_set_items i
        JOIN clinical.order_sets s ON s.id = i.order_set_id
        WHERE s.id = ${id} AND s.active AND i.id IN ${tx(body.item_ids)}
        ORDER BY i.position
      `;
      if (items.length !== body.item_ids.length) return null;
      const rows: Order[] = [];
      for (const item of items) {
        const [order] = await tx<Order[]>`
          INSERT INTO clinical.orders (admission_id, kind, payload, priority, created_by, order_set_item_id)
          VALUES (${body.admission_id}, ${item.kind}, ${tx.json(item.payload as Json)}, ${item.priority}, ${actor_user_id}, ${item.id}) RETURNING *
        `;
        await tx`
          INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
          VALUES (${actor_user_id}, 'create_from_order_set', 'clinical.orders', ${order.id}, ${tx.json(order as unknown as Json)})
        `;
        rows.push(order);
      }
      await tx`
        INSERT INTO clinical.order_set_applications (actor_user_id, idempotency_key, request_hash, order_ids)
        VALUES (${actor_user_id}, ${key}, ${requestHash}, ${rows.map((order) => order.id)}::uuid[])
      `;
      return rows;
    })
    .catch(rethrowDatabaseError);
}
