import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { ActiveAdmissionSchema, ErrorSchema, IdParam } from '../contracts/common';
import { InitialAssessmentBody, InitialAssessmentSchema } from '../contracts/initial_assessment';
import { canAccessAdmission } from '../db/queries/access';
import { getInitialAssessment, listRequiredInitialAssessments, signInitialAssessment } from '../db/queries/initial_assessments';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const initialAssessmentsRouter = new OpenAPIHono<{ Variables: Variables }>();

initialAssessmentsRouter.openapi(
  createRoute({
    method: 'get', path: '/admissions/initial-assessment-required', tags: ['Initial Assessment'],
    responses: {
      200: { content: { 'application/json': { schema: z.array(ActiveAdmissionSchema) } }, description: 'Admitted patients awaiting initial doctor assessment' },
      403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Duty doctor access required' },
    },
  }),
  async (c) => {
    if (c.get('user').job_role !== 'duty_doctor') return c.json({ error: 'duty doctor access required' }, 403);
    return c.json(await listRequiredInitialAssessments(), 200);
  },
);

initialAssessmentsRouter.openapi(
  createRoute({
    method: 'get', path: '/admissions/{id}/initial-assessment', tags: ['Initial Assessment'],
    request: { params: IdParam },
    responses: {
      200: { content: { 'application/json': { schema: InitialAssessmentSchema.nullable() } }, description: 'Signed initial assessment, or null if pending' },
      403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Admission not found or forbidden' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessAdmission(c.get('user'), id))) return c.json({ error: 'admission not found or forbidden' }, 403);
    const [assessment] = await getInitialAssessment(id);
    return c.json(assessment ?? null, 200);
  },
);

initialAssessmentsRouter.openapi(
  createRoute({
    method: 'post', path: '/admissions/{id}/initial-assessment', tags: ['Initial Assessment'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: InitialAssessmentBody } } } },
    responses: {
      201: { content: { 'application/json': { schema: InitialAssessmentSchema } }, description: 'Signed initial assessment and completed checklist' },
      403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Duty doctor access required' },
      409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Patient not admitted, checklist unavailable, or already assessed' },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'duty_doctor') return c.json({ error: 'duty doctor access required' }, 403);
    const { id } = c.req.valid('param');
    const assessment = await signInitialAssessment(id, user.id, c.req.valid('json'));
    if (!assessment) return c.json({ error: 'patient not admitted, checklist unavailable, or already assessed' }, 409);
    return c.json(assessment, 201);
  },
);
