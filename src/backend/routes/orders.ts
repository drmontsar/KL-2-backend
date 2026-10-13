import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  cancelOrder,
  cancelTask,
  completeTask,
  confirmOrder,
  listTasksByNurse,
} from '../db/queries/orders';
import { ErrorSchema, IdParam, OrderSchema, TaskSchema } from './schemas';

const ConfirmOrderBody = z.object({
  confirmed_by: z.string().uuid(),
  due_at: z.string().optional(),
});

const CompleteTaskBody = z.object({ completed_by: z.string().uuid() });

const ConfirmOrderResponseSchema = z.object({
  order: OrderSchema,
  task: TaskSchema,
});

export const ordersRouter = new OpenAPIHono();
export const tasksRouter = new OpenAPIHono();

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
    const { confirmed_by, due_at } = c.req.valid('json');
    const due = due_at ? new Date(due_at) : undefined;
    const result = await confirmOrder({
      order_id: id,
      confirmed_by,
      due_at: due,
    });
    return c.json(result, 200);
  }
);

ordersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['Orders'],
    request: { params: IdParam },
    responses: {
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
    const order = await cancelOrder(id);
    if (!order) {
      return c.json({ error: 'not found or not cancellable' }, 404);
    }
    return c.json(order, 200);
  }
);

tasksRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/complete',
    tags: ['Tasks'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: CompleteTaskBody } } },
    },
    responses: {
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
    const { completed_by } = c.req.valid('json');
    const task = await completeTask({ task_id: id, completed_by });
    if (!task) {
      return c.json({ error: 'not found or not pending' }, 404);
    }
    return c.json(task, 200);
  }
);

const TaskListQuery = z.object({
  nurse_id: z.string().uuid(),
  status: z.enum(['pending', 'done', 'cancelled']).optional(),
});

tasksRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Tasks'],
    request: { query: TaskListQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(TaskSchema) } },
        description: 'Tasks for the given nurse across all their admissions',
      },
    },
  }),
  async (c) => {
    const { nurse_id, status } = c.req.valid('query');
    const tasks = await listTasksByNurse(nurse_id, status);
    return c.json(tasks, 200);
  }
);

tasksRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['Tasks'],
    request: { params: IdParam },
    responses: {
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
    const task = await cancelTask(id);
    if (!task) {
      return c.json({ error: 'not found or not pending' }, 404);
    }
    return c.json(task, 200);
  }
);
