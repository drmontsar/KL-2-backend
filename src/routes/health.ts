import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { isReady } from '../services/readiness';

export const healthRouter = new OpenAPIHono();

healthRouter.openapi(
  createRoute({
    method: 'get',
    path: '/health',
    tags: ['Operations'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
        description: 'Process is running',
      },
    },
  }),
  (c) => c.json({ status: 'ok' as const }, 200),
);

healthRouter.openapi(
  createRoute({
    method: 'get',
    path: '/ready',
    tags: ['Operations'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ status: z.literal('ready') }) } },
        description: 'Database reachable and migrations applied',
      },
      503: {
        content: { 'application/json': { schema: z.object({ status: z.literal('not_ready') }) } },
        description: 'Database unavailable or migrations pending',
      },
    },
  }),
  async (c) => {
    return (await isReady())
      ? c.json({ status: 'ready' as const }, 200)
      : c.json({ status: 'not_ready' as const }, 503);
  },
);
