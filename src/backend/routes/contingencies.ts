import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  createContingency,
  deleteContingency,
  listContingencies,
} from '../db/queries/contingencies';
import { ContingencySchema, ErrorSchema } from './schemas';

const AdmissionParam = z.object({ admission_id: z.string().uuid() });
const CreateBody = z.object({ body: z.string().min(1), created_by: z.string().uuid() });

export const contingenciesRouter = new OpenAPIHono();

contingenciesRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{admission_id}/contingencies',
    tags: ['Contingencies'],
    request: { params: AdmissionParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(ContingencySchema) } },
        description: 'If/then contingencies for this admission',
      },
    },
  }),
  async (c) => {
    const { admission_id } = c.req.valid('param');
    const rows = await listContingencies(admission_id);
    return c.json(rows, 200);
  }
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
      201: {
        content: { 'application/json': { schema: ContingencySchema } },
        description: 'Contingency created',
      },
    },
  }),
  async (c) => {
    const { admission_id } = c.req.valid('param');
    const { body, created_by } = c.req.valid('json');
    const row = await createContingency({ admission_id, body, created_by });
    return c.json(row, 201);
  }
);

contingenciesRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/{admission_id}/contingencies/{id}',
    tags: ['Contingencies'],
    request: { params: AdmissionParam.extend({ id: z.string().uuid() }) },
    responses: {
      204: { description: 'Deleted' },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const deleted = await deleteContingency(id);
    if (!deleted) return c.json({ error: 'not found' }, 404);
    return c.body(null, 204);
  }
);
