import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import { ApplyBody, ApplyHeaders, SetBody, SetSchema } from '../contracts/order_sets';
import {
  applyOrderSet,
  createOrderSet,
  listOrderSetItems,
  listOrderSets,
} from '../db/queries/order_sets';

import { ErrorSchema, IdParam, OrderSchema } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const orderSetsRouter = new OpenAPIHono<{ Variables: Variables }>();

orderSetsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Order Sets'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(SetSchema) } },
        description: 'Active order sets',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Clinical access required',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.doctor') && !hasPermission(user, 'clinical.nurse'))
      return c.json({ error: 'clinical access required' }, 403);
    const sets = await listOrderSets();
    const ids = sets.map((set) => set.id);
    const items = ids.length ? await listOrderSetItems(ids) : [];
    return c.json(
      sets.map((set) => ({
        ...set,
        created_at: set.created_at.toISOString(),
        items: items.filter((item) => item.order_set_id === set.id),
      })),
      200,
    );
  },
);

orderSetsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Order Sets'],
    request: { body: { content: { 'application/json': { schema: SetBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: SetSchema } },
        description: 'Order set created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Administrator access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Order set name already exists',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'users.manage'))
      return c.json({ error: 'administrator access required' }, 403);
    const body = c.req.valid('json');

    const result = await createOrderSet(body, user.id);
    return c.json(result, 201);
  },
);

orderSetsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/apply',
    tags: ['Order Sets'],
    request: {
      params: IdParam,
      headers: ApplyHeaders,
      body: { content: { 'application/json': { schema: ApplyBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: z.array(OrderSchema) } },
        description: 'Selected draft orders created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Order set or items unavailable',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (
      !hasPermission(user, 'clinical.doctor') ||
      !(await canAccessAdmission(user, body.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const id = c.req.valid('param').id;
    const key = c.req.valid('header')['idempotency-key'];
    const orders = await applyOrderSet(user.id, key, body, id);
    if (!orders)
      return c.json(
        {
          error:
            'order set or items unavailable, or idempotency key reused for a different request',
        },
        409,
      );
    return c.json(orders, 201);
  },
);
