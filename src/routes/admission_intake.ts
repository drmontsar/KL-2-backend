import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import {
  AcceptBody,
  ChecklistSchema,
  CompleteBody,
  CreateBody,
  DeclineBody,
  RequestSchema,
} from '../contracts/admission_intake';
import {
  acceptAdmissionRequest,
  completeAdmissionChecklistItem,
  confirmPatientInBed,
  createAdmissionRequest,
  declineAdmissionRequest,
  getAdmissionChecklistItem,
  getAdmissionRequest,
  listAdmissionChecklist,
  listAdmissionRequests,
  takeNursingAssignment,
} from '../db/queries/admission_intake';

import { AdmissionSchema, ErrorSchema, IdParam } from '../contracts/common';
import { canAccessAdmission, canAccessPatient } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const admissionIntakeRouter = new OpenAPIHono<{ Variables: Variables }>();

admissionIntakeRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admission-requests',
    tags: ['Admission Intake'],
    request: { body: { content: { 'application/json': { schema: CreateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: RequestSchema } },
        description: 'Admission request created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Pending request or destination unavailable',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (
      !hasPermission(user, 'admissions.manage') ||
      !(await canAccessPatient(user, body.patient_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);

    const row = await createAdmissionRequest(body, user.id);
    return c.json(row, 201);
  },
);

admissionIntakeRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admission-requests',
    tags: ['Admission Intake'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(RequestSchema) } },
        description: 'Requests in user scope',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const rows = await listAdmissionRequests(user);
    return c.json(rows, 200);
  },
);

admissionIntakeRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admission-requests/{id}/accept',
    tags: ['Admission Intake'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: AcceptBody } } } },
    responses: {
      201: {
        content: {
          'application/json': {
            schema: z.object({ request: RequestSchema, admission: AdmissionSchema }),
          },
        },
        description: 'Patient incoming; bed reserved and nurse assigned',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Request, staff, or bed unavailable',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await getAdmissionRequest(id);
    if (
      !existing ||
      !hasPermission(user, 'admissions.manage') ||
      (user.job_role !== 'administrator' && existing.requested_by !== user.id)
    )
      return c.json({ error: 'not found or forbidden' }, 403);

    const result = await acceptAdmissionRequest(body, id, user.id);
    if (!result) return c.json({ error: 'request, staff, or bed unavailable' }, 409);
    return c.json(result, 201);
  },
);

admissionIntakeRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admission-requests/{id}/decline',
    tags: ['Admission Intake'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: DeclineBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: RequestSchema } },
        description: 'Request declined',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Request already resolved',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const [existing] = await getAdmissionRequest(id);
    if (
      !existing ||
      !hasPermission(user, 'admissions.manage') ||
      (user.job_role !== 'administrator' && existing.requested_by !== user.id)
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await declineAdmissionRequest(user.id, reason, id);
    if (!result) return c.json({ error: 'request already resolved' }, 409);
    return c.json(result, 200);
  },
);

admissionIntakeRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/take-nursing-assignment',
    tags: ['Admission Intake'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Bedside nursing assignment accepted',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission already assigned or outside nurse unit',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (user.role !== 'nurse') return c.json({ error: 'nurse access required' }, 403);
    const result = await takeNursingAssignment(user.id, id);
    if (!result) return c.json({ error: 'admission already assigned or outside nurse unit' }, 409);
    return c.json(result, 200);
  },
);

admissionIntakeRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/confirm-in-bed',
    tags: ['Admission Intake'],
    request: { params: IdParam },
    responses: {
      200: { content: { 'application/json': { schema: AdmissionSchema } }, description: 'Assigned nurse confirmed patient in bed' },
      403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Nurse access required' },
      409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Patient not incoming or not assigned to this nurse' },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'staff_nurse') return c.json({ error: 'nurse access required' }, 403);
    const { id } = c.req.valid('param');
    const admission = await confirmPatientInBed(id, user.id);
    if (!admission) return c.json({ error: 'patient not incoming or not assigned to this nurse' }, 409);
    return c.json(admission, 200);
  },
);

admissionIntakeRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}/admission-checklist',
    tags: ['Admission Intake'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(ChecklistSchema) } },
        description: 'Admission first-hours checklist',
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
    return c.json(await listAdmissionChecklist(id), 200);
  },
);

admissionIntakeRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admission-checklist/{id}/complete',
    tags: ['Admission Intake'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: CompleteBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: ChecklistSchema } },
        description: 'Checklist item completed',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Item already completed or admission closed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { evidence } = c.req.valid('json');
    const [item] = await getAdmissionChecklistItem(id);
    if (!item || !(await canAccessAdmission(user, item.admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    if (item.code === 'unit_arrival')
      return c.json({ error: 'use confirm-in-bed to complete unit arrival' }, 409);
    const permitted =
      user.job_role === 'administrator' ||
      (item.code === 'nursing_assessment'
        ? hasPermission(user, 'clinical.nurse')
        : hasPermission(user, 'clinical.doctor'));
    if (!permitted) return c.json({ error: 'not found or forbidden' }, 403);
    const result = await completeAdmissionChecklistItem(user.id, evidence, id);
    if (!result) return c.json({ error: 'item already completed or admission closed' }, 409);
    return c.json(result, 200);
  },
);
