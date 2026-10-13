import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  acknowledgeHandoff,
  doneHandoff,
  listHandoffs,
} from '../db/queries/handoffs';
import { ErrorSchema, HandoffSchema, IdParam } from './schemas';

const ListHandoffsQuery = z.object({
  nurse_id: z.string().uuid(),
  status: z.enum(['pending', 'acknowledged', 'done']).optional(),
});

const AcknowledgeBody = z.object({ acknowledged_by: z.string().uuid() });

export const handoffsRouter = new OpenAPIHono();

handoffsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Handoffs'],
    request: { query: ListHandoffsQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(HandoffSchema) } },
        description: 'Handoffs for the given nurse',
      },
    },
  }),
  async (c) => {
    const { nurse_id, status } = c.req.valid('query');
    const handoffs = await listHandoffs({ nurse_id, status });
    return c.json(handoffs, 200);
  }
);

handoffsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/acknowledge',
    tags: ['Handoffs'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: AcknowledgeBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: HandoffSchema } },
        description: 'Handoff acknowledged',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or not pending',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { acknowledged_by } = c.req.valid('json');
    const handoff = await acknowledgeHandoff(id, acknowledged_by);
    if (!handoff) {
      return c.json({ error: 'not found or not pending' }, 404);
    }
    return c.json(handoff, 200);
  }
);

handoffsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/done',
    tags: ['Handoffs'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: HandoffSchema } },
        description: 'Handoff marked done',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or already done',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const handoff = await doneHandoff(id);
    if (!handoff) {
      return c.json({ error: 'not found or already done' }, 404);
    }
    return c.json(handoff, 200);
  }
);
