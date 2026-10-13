import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../db/queries/notifications';
import { ErrorSchema, NotificationSchema } from './schemas';

const ListQuery = z.object({
  user_id: z.string().uuid(),
  unread_only: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ReadAllQuery = z.object({ user_id: z.string().uuid() });

const ReadParam = z.object({ id: z.string().uuid() });
const ReadBody = z.object({ user_id: z.string().uuid() });

export const notificationsRouter = new OpenAPIHono();

notificationsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Notifications'],
    request: { query: ListQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(NotificationSchema) } },
        description: 'Notifications for the user',
      },
    },
  }),
  async (c) => {
    const { user_id, unread_only, limit } = c.req.valid('query');
    const notifications = await listNotifications({ user_id, unread_only, limit });
    return c.json(notifications, 200);
  }
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/read',
    tags: ['Notifications'],
    request: {
      params: ReadParam,
      body: { content: { 'application/json': { schema: ReadBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: NotificationSchema } },
        description: 'Notification marked read',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or already read',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { user_id } = c.req.valid('json');
    const notification = await markNotificationRead(id, user_id);
    if (!notification) {
      return c.json({ error: 'not found or already read' }, 404);
    }
    return c.json(notification, 200);
  }
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/read-all',
    tags: ['Notifications'],
    request: {
      body: { content: { 'application/json': { schema: ReadAllQuery } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ marked: z.number() }) } },
        description: 'All notifications marked read',
      },
    },
  }),
  async (c) => {
    const { user_id } = c.req.valid('json');
    const marked = await markAllNotificationsRead(user_id);
    return c.json({ marked }, 200);
  }
);
