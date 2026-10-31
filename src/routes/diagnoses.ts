import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { hasPermission } from '../authorization';
import { DiagnosisSchema, ErrorSchema, IdParam } from '../contracts/common';
import { canAccessResource } from '../db/queries/access';
import { reopenDiagnosis, resolveDiagnosis } from '../db/queries/diagnoses';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const diagnosesRouter = new OpenAPIHono<{ Variables: Variables }>();

diagnosesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/resolve',
    tags: ['Diagnoses'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
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
    const user = c.get('user');
    if (
      !hasPermission(user, 'clinical.doctor') ||
      !(await canAccessResource(user, 'diagnosis', id))
    ) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const diagnosis = await resolveDiagnosis(id, c.get('user').id);
    if (!diagnosis) {
      return c.json({ error: 'not found or already resolved' }, 404);
    }
    return c.json(diagnosis, 200);
  },
);

diagnosesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/reopen',
    tags: ['Diagnoses'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
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
    const user = c.get('user');
    if (
      !hasPermission(user, 'clinical.doctor') ||
      !(await canAccessResource(user, 'diagnosis', id))
    ) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const diagnosis = await reopenDiagnosis(id, c.get('user').id);
    if (!diagnosis) {
      return c.json({ error: 'not found or already active' }, 404);
    }
    return c.json(diagnosis, 200);
  },
);
