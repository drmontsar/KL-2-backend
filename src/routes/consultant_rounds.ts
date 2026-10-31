import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { RoundBody, RoundSchema, WorklistSchema } from '../contracts/consultant_rounds';
import {
  signConsultantRound,
  getConsultantContext,
  listConsultantWorklist,
} from '../db/queries/consultant_rounds';

import { ErrorSchema, IdParam, NoteSchema, OrderSchema, VitalsSchema } from '../contracts/common';
import { listNotesByAdmission } from '../db/queries/notes';
import { listOrdersByAdmission } from '../db/queries/orders';
import type { User } from '../db/queries/users';
import { listObservationsByAdmission } from '../db/queries/vitals';

type Variables = { user: User };

export const consultantRoundsRouter = new OpenAPIHono<{ Variables: Variables }>();

consultantRoundsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/worklist',
    tags: ['Consultant Rounds'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(WorklistSchema) } },
        description: 'Assigned consultant patients, not-seen and sickest first',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Consultant access required',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'consultant') return c.json({ error: 'consultant access required' }, 403);
    const rows = await listConsultantWorklist(user.id);
    return c.json(rows, 200);
  },
);

consultantRoundsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/context',
    tags: ['Consultant Rounds'],
    request: { params: IdParam },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({
              observations: z.array(VitalsSchema),
              notes: z.array(NoteSchema),
              orders: z.array(OrderSchema),
            }),
          },
        },
        description: 'Patient context for consultant round',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Patient is not assigned to consultant',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (user.job_role !== 'consultant') return c.json({ error: 'consultant access required' }, 403);
    const [admission] = await getConsultantContext(id, user.id);
    if (!admission) return c.json({ error: 'patient is not assigned to consultant' }, 403);
    const [observations, notes, orders] = await Promise.all([
      listObservationsByAdmission(id, 6),
      listNotesByAdmission(id),
      listOrdersByAdmission(id),
    ]);
    return c.json({ observations, notes, orders }, 200);
  },
);

consultantRoundsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Consultant Rounds'],
    request: { body: { content: { 'application/json': { schema: RoundBody } } } },
    responses: {
      201: {
        content: {
          'application/json': {
            schema: z.object({ round: RoundSchema, orders: z.array(OrderSchema) }),
          },
        },
        description: 'Signed round and orders',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Consultant access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Patient is not assigned to consultant or admission is closed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'consultant') return c.json({ error: 'consultant access required' }, 403);
    const body = c.req.valid('json');
    const result = await signConsultantRound(body, user.id);
    if (!result)
      return c.json({ error: 'patient is not assigned to consultant or admission is closed' }, 409);
    return c.json(result, 201);
  },
);
