import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { ContingencySchema, ErrorSchema } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import {
  createContingency,
  deleteContingency,
  listContingencies,
} from '../db/queries/contingencies';
import type { User } from '../db/queries/users';

type Variables = { user: User };

const AdmissionParam = z.object({ admission_id: z.string().uuid() });
const CreateBody = z.object({ body: z.string().min(1) });

export const contingenciesRouter = new OpenAPIHono<{ Variables: Variables }>();

contingenciesRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{admission_id}/contingencies',
    tags: ['Contingencies'],
    request: { params: AdmissionParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(ContingencySchema) } },
        description: 'If/then contingencies for this admission',
      },
    },
  }),
  async (c) => {
    const { admission_id } = c.req.valid('param');
    if (!(await canAccessAdmission(c.get('user'), admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const rows = await listContingencies(admission_id);
    return c.json(rows, 200);
  },
);

contingenciesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{admission_id}/contingencies',
    tags: ['Contingencies'],
    request: {
      params: AdmissionParam,
      body: { content: { 'application/json': { schema: CreateBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: ContingencySchema } },
        description: 'Contingency created',
      },
    },
  }),
  async (c) => {
    const { admission_id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await canAccessAdmission(user, admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const { body } = c.req.valid('json');
    const row = await createContingency({ admission_id, body, created_by: user.id });
    return c.json(row, 201);
  },
);

contingenciesRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/{admission_id}/contingencies/{id}',
    tags: ['Contingencies'],
    request: { params: AdmissionParam.extend({ id: z.string().uuid() }) },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      204: { description: 'Deleted' },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not found' },
    },
  }),
  async (c) => {
    const { admission_id, id } = c.req.valid('param');
    if (!(await canAccessAdmission(c.get('user'), admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const deleted = await deleteContingency(id, admission_id);
    if (!deleted) return c.json({ error: 'not found' }, 404);
    return c.body(null, 204);
  },
);
