import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { ErrorSchema, NotificationSchema } from '../contracts/common';
import {
  acknowledgeNotification,
  closeNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../db/queries/notifications';
import type { User } from '../db/queries/users';

type Variables = { user: User };

const ListQuery = z.object({
  unread_only: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ReadParam = z.object({ id: z.string().uuid() });

export const notificationsRouter = new OpenAPIHono<{ Variables: Variables }>();

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
    const { unread_only, limit } = c.req.valid('query');
    const notifications = await listNotifications({
      user_id: c.get('user').id,
      unread_only,
      limit,
    });
    return c.json(notifications, 200);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/read',
    tags: ['Notifications'],
    request: {
      params: ReadParam,
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
    const notification = await markNotificationRead(id, c.get('user').id);
    if (!notification) {
      return c.json({ error: 'not found or already read' }, 404);
    }
    return c.json(notification, 200);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/acknowledge',
    tags: ['Notifications'],
    request: { params: ReadParam },
    responses: {
      200: {
        content: { 'application/json': { schema: NotificationSchema } },
        description: 'Notification acknowledged',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or closed',
      },
    },
  }),
  async (c) => {
    const row = await acknowledgeNotification(c.req.valid('param').id, c.get('user').id);
    if (!row) return c.json({ error: 'not found or closed' }, 404);
    return c.json(row, 200);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/close',
    tags: ['Notifications'],
    request: { params: ReadParam },
    responses: {
      200: {
        content: { 'application/json': { schema: NotificationSchema } },
        description: 'Notification closed',
      },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not found' },
    },
  }),
  async (c) => {
    const row = await closeNotification(c.req.valid('param').id, c.get('user').id);
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row, 200);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/read-all',
    tags: ['Notifications'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ marked: z.number() }) } },
        description: 'All notifications marked read',
      },
    },
  }),
  async (c) => {
    const marked = await markAllNotificationsRead(c.get('user').id);
    return c.json({ marked }, 200);
  },
);
