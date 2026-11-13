import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import { ErrorSchema, IdParam, OrderSchema, TaskSchema } from '../contracts/common';
import { canAccessResource } from '../db/queries/access';
import {
  acknowledgeOrder,
  cancelOrder,
  cancelTask,
  closeOrder,
  completeTask,
  confirmOrder,
  decideOrderApproval,
  listTasksByNurse,
} from '../db/queries/orders';
import type { User } from '../db/queries/users';

const ConfirmOrderBody = z.object({ due_at: z.string().datetime({ offset: true }).optional() });
const CloseOrderBody = z.object({ reason: z.string().trim().min(3).max(500) });
const ApprovalBody = z.object({ reason: z.string().trim().min(3).max(500) });

const ConfirmOrderResponseSchema = z.object({
  order: OrderSchema,
  task: TaskSchema,
});

type Variables = { user: User };

export const ordersRouter = new OpenAPIHono<{ Variables: Variables }>();
export const tasksRouter = new OpenAPIHono<{ Variables: Variables }>();

ordersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/confirm',
    tags: ['Orders'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: ConfirmOrderBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: ConfirmOrderResponseSchema } },
        description: 'Order confirmed, task created',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Order not found or not in draft',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.doctor') || !(await canAccessResource(user, 'order', id))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const { due_at } = c.req.valid('json');
    const due = due_at ? new Date(due_at) : undefined;
    const result = await confirmOrder({
      order_id: id,
      confirmed_by: user.id,
      due_at: due,
    });
    if (!result) return c.json({ error: 'not found or not in draft' }, 404);
    return c.json(result, 200);
  },
);

for (const decision of ['approved', 'rejected'] as const) {
  ordersRouter.openapi(
    createRoute({
      method: 'post',
      path: `/{id}/approval/${decision}`,
      tags: ['Orders'],
      request: {
        params: IdParam,
        body: { content: { 'application/json': { schema: ApprovalBody } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: OrderSchema } },
          description: 'Approval decision recorded',
        },
        403: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Consultant access required',
        },
        409: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Order is not awaiting approval',
        },
      },
    }),
    async (c) => {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      if (user.job_role !== 'consultant' || !(await canAccessResource(user, 'order', id))) {
        return c.json({ error: 'consultant access required' }, 403);
      }
      const order = await decideOrderApproval({
        id,
        user_id: user.id,
        decision,
        reason: c.req.valid('json').reason,
      });
      if (!order) return c.json({ error: 'order is not awaiting approval' }, 409);
      return c.json(order, 200);
    },
  );
}

ordersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/acknowledge',
    tags: ['Orders'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: OrderSchema } },
        description: 'Order acknowledged',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Order is not confirmed or already acknowledged',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.nurse') || !(await canAccessResource(user, 'order', id))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const order = await acknowledgeOrder(id, user.id);
    if (!order) return c.json({ error: 'order is not confirmed or already acknowledged' }, 409);
    return c.json(order, 200);
  },
);

for (const action of ['complete', 'discontinue'] as const) {
  ordersRouter.openapi(
    createRoute({
      method: 'post',
      path: `/{id}/${action}`,
      tags: ['Orders'],
      request: {
        params: IdParam,
        body: { content: { 'application/json': { schema: CloseOrderBody } } },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: OrderSchema } },
          description: 'Order closed',
        },
        403: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Not found or access denied',
        },
        409: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Order is not active or has pending tasks',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const user = c.get('user');
      if (
        !hasPermission(user, 'clinical.doctor') ||
        !(await canAccessResource(user, 'order', id))
      ) {
        return c.json({ error: 'not found or forbidden' }, 403);
      }
      const order = await closeOrder({
        id,
        user_id: user.id,
        status: action === 'complete' ? 'completed' : 'discontinued',
        reason: c.req.valid('json').reason,
      });
      if (!order) return c.json({ error: 'order is not active or has pending tasks' }, 409);
      return c.json(order, 200);
    },
  );
}

ordersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['Orders'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: OrderSchema } },
        description: 'Order cancelled',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Order not found or not cancellable',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.doctor') || !(await canAccessResource(user, 'order', id))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const order = await cancelOrder(id, user.id);
    if (!order) {
      return c.json({ error: 'not found or not cancellable' }, 404);
    }
    return c.json(order, 200);
  },
);

tasksRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/complete',
    tags: ['Tasks'],
    request: {
      params: IdParam,
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: TaskSchema } },
        description: 'Task completed',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Task not found or not pending',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.nurse'))
      return c.json({ error: 'nursing access required' }, 403);
    if (!(await canAccessResource(user, 'task', id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const task = await completeTask({ task_id: id, completed_by: user.id });
    if (!task) {
      return c.json({ error: 'not found or not pending' }, 404);
    }
    return c.json(task, 200);
  },
);

const TaskListQuery = z.object({
  nurse_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'done', 'cancelled']).optional(),
});

tasksRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Tasks'],
    request: { query: TaskListQuery },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(TaskSchema) } },
        description: 'Tasks for the given nurse across all their admissions',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.nurse'))
      return c.json({ error: 'nursing access required' }, 403);
    const { nurse_id, status } = c.req.valid('query');
    const tasks = await listTasksByNurse(
      user.job_role === 'administrator' && nurse_id ? nurse_id : user.id,
      status,
    );
    return c.json(tasks, 200);
  },
);

tasksRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['Tasks'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: TaskSchema } },
        description: 'Task cancelled',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Task not found or not pending',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.nurse'))
      return c.json({ error: 'nursing access required' }, 403);
    if (!(await canAccessResource(user, 'task', id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const task = await cancelTask(id, user.id);
    if (!task) {
      return c.json({ error: 'not found or not pending' }, 404);
    }
    return c.json(task, 200);
  },
);
