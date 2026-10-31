import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { acknowledgeHandoff, doneHandoff, listHandoffs } from '../db/queries/handoffs';

import { ErrorSchema, HandoffSchema, IdParam } from '../contracts/common';
import { canAccessResource } from '../db/queries/access';
import type { User } from '../db/queries/users';

const ListHandoffsQuery = z.object({
  nurse_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'acknowledged', 'done']).optional(),
});

const AcknowledgeBody = z.object({ readback: z.string().optional() });

type Variables = { user: User };

export const handoffsRouter = new OpenAPIHono<{ Variables: Variables }>();

handoffsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Handoffs'],
    request: { query: ListHandoffsQuery },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(HandoffSchema) } },
        description: 'Handoffs for the given nurse',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'staff_nurse' && user.job_role !== 'administrator')
      return c.json({ error: 'only nurses and admins can list nurse handoffs' }, 403);
    const { nurse_id, status } = c.req.valid('query');
    const handoffs = await listHandoffs({
      nurse_id: user.job_role === 'administrator' && nurse_id ? nurse_id : user.id,
      status,
    });
    return c.json(handoffs, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
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
    const user = c.get('user');
    if (user.role !== 'nurse' || !(await canAccessResource(user, 'handoff', id))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const { readback } = c.req.valid('json');
    const handoff = await acknowledgeHandoff(id, user.id, readback);
    if (!handoff) {
      return c.json({ error: 'not found or not pending' }, 404);
    }

    return c.json(handoff, 200);
  },
);

handoffsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/done',
    tags: ['Handoffs'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
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
    const user = c.get('user');
    if (!(await canAccessResource(user, 'handoff', id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const handoff = await doneHandoff(id, user.id);
    if (!handoff) {
      return c.json({ error: 'not found or already done' }, 404);
    }

    return c.json(handoff, 200);
  },
);
