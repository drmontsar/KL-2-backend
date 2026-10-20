import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { createShiftEvent, listShiftEvents } from '../db/queries/shift_events';
import { ShiftEventSchema } from './schemas';

const AdmissionParam = z.object({ admission_id: z.string().uuid() });
const CreateBody = z.object({ body: z.string().min(1), logged_by: z.string().uuid() });

export const shiftEventsRouter = new OpenAPIHono();

shiftEventsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{admission_id}/events',
    tags: ['Shift Events'],
    request: { params: AdmissionParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(ShiftEventSchema) } },
        description: 'Shift events for this admission',
      },
    },
  }),
  async (c) => {
    const { admission_id } = c.req.valid('param');
    const rows = await listShiftEvents(admission_id);
    return c.json(rows, 200);
  }
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
      201: {
        content: { 'application/json': { schema: ShiftEventSchema } },
        description: 'Event logged',
      },
    },
  }),
  async (c) => {
    const { admission_id } = c.req.valid('param');
    const { body, logged_by } = c.req.valid('json');
    const row = await createShiftEvent({ admission_id, body, logged_by });
    return c.json(row, 201);
  }
);
