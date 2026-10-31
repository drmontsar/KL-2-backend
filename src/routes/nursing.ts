import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import {
  AssessmentBody,
  AssessmentSchema,
  CallBody,
  CallSchema,
  CompleteTaskBody,
  FluidBody,
  FluidQuery,
  FluidSchema,
  ReplyBody,
  TaskBody,
  TaskSchema,
  UrineAlertSchema,
  WeightBody,
  WeightSchema,
} from '../contracts/nursing';
import {
  acknowledgeSbarCall,
  closeSbarCall,
  completeNursingTask,
  createNursingTask,
  getFluidBalance,
  getNursingTask,
  listNursingAssessments,
  listNursingTasks,
  listSbarCalls,
  recordFluidEntry,
  recordPatientWeight,
  sendSbarCall,
  signNursingAssessment,
} from '../db/queries/nursing';

import { ErrorSchema, IdParam } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const nursingRouter = new OpenAPIHono<{ Variables: Variables }>();

nursingRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}/nursing-assessments',
    tags: ['Nursing'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(AssessmentSchema) } },
        description: 'Nursing assessment history',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessAdmission(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listNursingAssessments(id), 200);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/nursing-assessments',
    tags: ['Nursing'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: AssessmentBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: AssessmentSchema } },
        description: 'Signed assessment and care plan',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission is not active',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.nurse') || !(await canAccessAdmission(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const row = await signNursingAssessment(id, user.id, body);
    if (!row) return c.json({ error: 'admission is not active' }, 409);
    return c.json(row, 201);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}/nursing-tasks',
    tags: ['Nursing'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(TaskSchema) } },
        description: 'Recurring nursing tasks',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessAdmission(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listNursingTasks(id), 200);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/nursing-tasks',
    tags: ['Nursing'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: TaskBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: TaskSchema } },
        description: 'Recurring task created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission not active',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.nurse') || !(await canAccessAdmission(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const row = await createNursingTask(body, user.id, id);
    if (!row) return c.json({ error: 'admission not active' }, 409);
    return c.json(row, 201);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'post',
    path: '/nursing-tasks/{id}/complete',
    tags: ['Nursing'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: CompleteTaskBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: TaskSchema } },
        description: 'Task completed and rescheduled',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Task is no longer active or due',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { expected_due_at } = c.req.valid('json');
    const [existing] = await getNursingTask(id);
    if (
      !existing ||
      !hasPermission(user, 'clinical.nurse') ||
      !(await canAccessAdmission(user, existing.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const row = await completeNursingTask(existing.admission_id, id, expected_due_at, user.id);
    if (!row) return c.json({ error: 'task is no longer active or due' }, 409);
    return c.json(row, 200);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/weights',
    tags: ['Nursing'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: WeightBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: WeightSchema } },
        description: 'Measured weight recorded',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission inactive or measurement is in the future',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.nurse') || !(await canAccessAdmission(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const weight = await recordPatientWeight(id, body, user.id);
    if (!weight)
      return c.json({ error: 'admission inactive or measurement is in the future' }, 409);
    return c.json(weight, 201);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/fluid-entries',
    tags: ['Nursing'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: FluidBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: FluidSchema } },
        description: 'Intake/output recorded',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission not active',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.nurse') || !(await canAccessAdmission(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const row = await recordFluidEntry(id, user.id, body);
    if (!row) return c.json({ error: 'admission not active' }, 409);
    return c.json(row, 201);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}/fluid-entries',
    tags: ['Nursing'],
    request: { params: IdParam, query: FluidQuery },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({
              entries: z.array(FluidSchema),
              intake_ml: z.number(),
              output_ml: z.number(),
              balance_ml: z.number(),
              urine_alert: UrineAlertSchema,
            }),
          },
        },
        description: 'Fluid entries and balance for requested interval',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { from, to } = c.req.valid('query');
    if (!(await canAccessAdmission(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await getFluidBalance(id, from, to), 200);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/sbar-calls',
    tags: ['Nursing'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: CallBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: CallSchema } },
        description: 'SBAR call sent',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Duty doctor or admission unavailable',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.nurse') || !(await canAccessAdmission(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const row = await sendSbarCall(user.id, body, id);
    if (!row) return c.json({ error: 'duty doctor or admission unavailable' }, 409);
    return c.json(row, 201);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'get',
    path: '/sbar-calls',
    tags: ['Nursing'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(CallSchema) } },
        description: 'Calls involving current user',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    return c.json(await listSbarCalls(user.id), 200);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'post',
    path: '/sbar-calls/{id}/acknowledge',
    tags: ['Nursing'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ReplyBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: CallSchema } },
        description: 'Call acknowledged',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Call not open or not assigned to doctor',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { reply } = c.req.valid('json');
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);
    const row = await acknowledgeSbarCall(reply, id, user.id);
    if (!row) return c.json({ error: 'call not open or not assigned to doctor' }, 409);
    return c.json(row, 200);
  },
);

nursingRouter.openapi(
  createRoute({
    method: 'post',
    path: '/sbar-calls/{id}/close',
    tags: ['Nursing'],
    request: { params: IdParam },
    responses: {
      200: { content: { 'application/json': { schema: CallSchema } }, description: 'Call closed' },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Call not acknowledged or not owned',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const row = await closeSbarCall(user.id, id);
    if (!row) return c.json({ error: 'call not acknowledged or not owned' }, 409);
    return c.json(row, 200);
  },
);
