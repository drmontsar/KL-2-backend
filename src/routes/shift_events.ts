import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { ErrorSchema, ShiftEventSchema } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import { createShiftEvent, listShiftEvents } from '../db/queries/shift_events';
import type { User } from '../db/queries/users';

type Variables = { user: User };

const AdmissionParam = z.object({ admission_id: z.string().uuid() });
const CreateBody = z.object({ body: z.string().min(1) });

export const shiftEventsRouter = new OpenAPIHono<{ Variables: Variables }>();

shiftEventsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{admission_id}/events',
    tags: ['Shift Events'],
    request: { params: AdmissionParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(ShiftEventSchema) } },
        description: 'Shift events for this admission',
      },
    },
  }),
  async (c) => {
    const { admission_id } = c.req.valid('param');
    if (!(await canAccessAdmission(c.get('user'), admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const rows = await listShiftEvents(admission_id);
    return c.json(rows, 200);
  },
);

shiftEventsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{admission_id}/events',
    tags: ['Shift Events'],
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
        content: { 'application/json': { schema: ShiftEventSchema } },
        description: 'Event logged',
      },
    },
  }),
  async (c) => {
    const { admission_id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await canAccessAdmission(user, admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const { body } = c.req.valid('json');
    const row = await createShiftEvent({ admission_id, body, logged_by: user.id });
    return c.json(row, 201);
  },
);
