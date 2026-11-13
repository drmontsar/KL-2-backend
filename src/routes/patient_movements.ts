import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import { CreateBody, MovementSchema, ReserveBody } from '../contracts/patient_movements';
import {
  getPatientMovement,
  listAdmissionMovements,
  requestPatientMovement,
  reserveMovementBed,
  transitionPatientMovement,
} from '../db/queries/patient_movements';

import { ErrorSchema, IdParam } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const patientMovementsRouter = new OpenAPIHono<{ Variables: Variables }>();

patientMovementsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Patient Movement'],
    request: { body: { content: { 'application/json': { schema: CreateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: MovementSchema } },
        description: 'Movement requested',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Active movement, bed unavailable, NEWS2 missing, or escort unsafe',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (
      (body.movement_type === 'temporary' && !hasPermission(user, 'clinical.nurse')) ||
      (!hasPermission(user, 'clinical.doctor') && !hasPermission(user, 'clinical.nurse')) ||
      !(await canAccessAdmission(user, body.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);

    const movement = await requestPatientMovement(body, user.id);
    if (!movement)
      return c.json(
        { error: 'managed bed and NEWS2 required; NEWS2 >= 5 requires nurse or doctor escort' },
        409,
      );
    return c.json(movement, 201);
  },
);

patientMovementsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}',
    tags: ['Patient Movement'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(MovementSchema) } },
        description: 'Movement history for admission',
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
    return c.json(await listAdmissionMovements(id), 200);
  },
);

patientMovementsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/reserve',
    tags: ['Patient Movement'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: ReserveBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: MovementSchema } },
        description: 'Destination bed reserved',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Bed-desk access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Movement or bed unavailable',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { bed_id } = c.req.valid('json');
    if (!['administrator', 'bed_desk'].includes(user.job_role))
      return c.json({ error: 'bed-desk access required' }, 403);

    const result = await reserveMovementBed(bed_id, id, user);
    if (!result) return c.json({ error: 'movement or bed unavailable' }, 409);
    return c.json(result, 200);
  },
);

for (const action of ['depart', 'arrive', 'return', 'cancel'] as const) {
  patientMovementsRouter.openapi(
    createRoute({
      method: 'post',
      path: `/{id}/${action}`,
      tags: ['Patient Movement'],
      request: { params: IdParam },
      responses: {
        200: {
          content: { 'application/json': { schema: MovementSchema } },
          description: 'Movement updated',
        },
        403: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Not found or access denied',
        },
        409: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Invalid transition, stale bed assignment, or unsafe escort',
        },
      },
    }),
    async (c) => {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      const [existing] = await getPatientMovement(id);
      if (
        !existing ||
        (existing.movement_type === 'temporary' && !hasPermission(user, 'clinical.nurse')) ||
        (!hasPermission(user, 'clinical.doctor') && !hasPermission(user, 'clinical.nurse')) ||
        !(await canAccessAdmission(user, existing.admission_id))
      )
        return c.json({ error: 'not found or forbidden' }, 403);
      const result = await transitionPatientMovement(id, action, user.id);
      if (!result)
        return c.json({ error: 'invalid transition, stale bed assignment, or unsafe escort' }, 409);
      return c.json(result, 200);
    },
  );
}
