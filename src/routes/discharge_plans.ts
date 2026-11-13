import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import {
  CreateBody,
  PlanSchema,
  SummaryBody,
  TaskBody,
  TaskSchema,
} from '../contracts/discharge_plans';
import {
  approveDischargePlan,
  canAccessDischargePlan,
  cancelDischargePlan,
  completeDischarge,
  completeDischargeTask,
  createDischargePlan,
  getDischargePlan,
  getDischargeTask,
  listDischargePlans,
  listDischargeTasks,
  signDischargeSummary,
} from '../db/queries/discharge_plans';

import { ErrorSchema, IdParam } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const dischargePlansRouter = new OpenAPIHono<{ Variables: Variables }>();

dischargePlansRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Discharge'],
    request: { body: { content: { 'application/json': { schema: CreateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: PlanSchema } },
        description: 'Discharge plan created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission inactive or plan already open',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (
      !hasPermission(user, 'clinical.doctor') ||
      !(await canAccessAdmission(user, body.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);

    const result = await createDischargePlan(body, user.id);
    if (!result) return c.json({ error: 'admission inactive or form unavailable' }, 409);
    return c.json(result, 201);
  },
);

dischargePlansRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}',
    tags: ['Discharge'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(PlanSchema) } },
        description: 'Discharge plans for an admission',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessDischargePlan(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listDischargePlans(id), 200);
  },
);

dischargePlansRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['Discharge'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: PlanSchema } },
        description: 'Discharge plan cancelled',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Plan already resolved',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const existing = await getDischargePlan(id);
    if (
      !existing ||
      !hasPermission(user, 'clinical.doctor') ||
      !(await canAccessAdmission(user, existing.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await cancelDischargePlan(id, user.id);
    if (!result) return c.json({ error: 'plan already resolved' }, 409);
    return c.json(result, 200);
  },
);

dischargePlansRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Discharge'],
    request: { params: IdParam },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({ plan: PlanSchema, tasks: z.array(TaskSchema) }),
          },
        },
        description: 'Discharge plan and checklist',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const plan = await getDischargePlan(id);
    if (!plan || !(await canAccessDischargePlan(c.get('user'), plan.admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json({ plan, tasks: await listDischargeTasks(id) }, 200);
  },
);

dischargePlansRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/approve',
    tags: ['Discharge'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: PlanSchema } },
        description: 'Discharge approved',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Treating consultant access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Plan unavailable or home discharge unsafe',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (user.job_role !== 'consultant')
      return c.json({ error: 'treating consultant access required' }, 403);
    const result = await approveDischargePlan(user.id, id);
    if (!result)
      return c.json({ error: 'plan unavailable, not assigned, or home discharge unsafe' }, 409);
    return c.json(result, 200);
  },
);

dischargePlansRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/summary',
    tags: ['Discharge'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: SummaryBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: PlanSchema } },
        description: 'Discharge summary signed',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Plan unavailable or summary already signed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const plan = await getDischargePlan(id);
    if (
      !plan ||
      !hasPermission(user, 'clinical.doctor') ||
      !(await canAccessAdmission(user, plan.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await signDischargeSummary(body.summary, user.id, id, body.final_diagnosis);
    if (!result) return c.json({ error: 'plan unavailable or summary already signed' }, 409);
    return c.json(result, 200);
  },
);

dischargePlansRouter.openapi(
  createRoute({
    method: 'post',
    path: '/tasks/{id}/complete',
    tags: ['Discharge'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: TaskBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: TaskSchema } },
        description: 'Discharge task completed',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Task unavailable or prerequisite missing',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await getDischargeTask(id);
    if (!existing || !(await canAccessDischargePlan(user, existing.admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const allowed =
      user.job_role === 'administrator' ||
      (existing.code === 'pending_results' && hasPermission(user, 'clinical.doctor')) ||
      (existing.code === 'medication_reconciliation' &&
        (hasPermission(user, 'clinical.doctor') || user.job_role === 'pharmacist')) ||
      (existing.code === 'nursing' && hasPermission(user, 'clinical.nurse')) ||
      (['billing', 'insurance', 'payment'].includes(existing.code) &&
        user.job_role === 'billing_insurance');
    if (!allowed || existing.code === 'summary')
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await completeDischargeTask(id, body.evidence, user.id);
    if (!result) return c.json({ error: 'task unavailable or prerequisite missing' }, 409);
    return c.json(result, 200);
  },
);

dischargePlansRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/complete',
    tags: ['Discharge'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: PlanSchema } },
        description: 'Patient departure confirmed and bed released',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description:
          'Approval, checklist, clinical, form, insurance, or movement gate not satisfied',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const existing = await getDischargePlan(id);
    if (
      !existing ||
      (!hasPermission(user, 'clinical.nurse') && !hasPermission(user, 'clinical.doctor')) ||
      !(await canAccessAdmission(user, existing.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await completeDischarge(id, user.id);
    if (!result)
      return c.json(
        { error: 'approval, checklist, clinical, form, insurance, or movement gate not satisfied' },
        409,
      );
    return c.json(result, 200);
  },
);
