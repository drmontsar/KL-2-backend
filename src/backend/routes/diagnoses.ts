import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { reopenDiagnosis, resolveDiagnosis } from '../db/queries/diagnoses';
import { DiagnosisSchema, ErrorSchema, IdParam } from './schemas';

export const diagnosesRouter = new OpenAPIHono();

diagnosesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/resolve',
    tags: ['Diagnoses'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: DiagnosisSchema } },
        description: 'Diagnosis resolved',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Diagnosis not found or already resolved',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const diagnosis = await resolveDiagnosis(id);
    if (!diagnosis) {
      return c.json({ error: 'not found or already resolved' }, 404);
    }
    return c.json(diagnosis, 200);
  }
);

diagnosesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/reopen',
    tags: ['Diagnoses'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: DiagnosisSchema } },
        description: 'Diagnosis reopened',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Diagnosis not found or already active',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const diagnosis = await reopenDiagnosis(id);
    if (!diagnosis) {
      return c.json({ error: 'not found or already active' }, 404);
    }
    return c.json(diagnosis, 200);
  }
);
