import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { User } from '../db/queries/users';
import {
  acknowledgeHandoverItem,
  createHandoverSession,
  getHandoverSession,
  listHandoverSessions,
} from '../db/queries/handover_sessions';
import { createNotification } from '../db/queries/notifications';
import {
  ErrorSchema,
  HandoverAcknowledgmentSchema,
  HandoverSessionDetailSchema,
  HandoverSessionSchema,
  IdParam,
} from './schemas';

type Variables = { user: User };

const CreateSessionBody = z.object({
  incoming_doctor_id: z.string().uuid(),
  ward: z.string().optional(),
});

const ListSessionQuery = z.object({
  role: z.enum(['outgoing', 'incoming', 'all']).optional(),
});

const AcknowledgeItemBody = z.object({
  notes: z.string().optional(),
});

export const handoverSessionsRouter = new OpenAPIHono<{ Variables: Variables }>();

handoverSessionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Handover Sessions'],
    request: {
      body: { content: { 'application/json': { schema: CreateSessionBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: HandoverSessionDetailSchema } },
        description: 'Handover session created — incoming doctor notified',
      },
      400: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'No active patients to hand over, or target doctor invalid',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Only doctors can create handover sessions',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.role !== 'doctor') return c.json({ error: 'only doctors can create handover sessions' }, 403);
    const { incoming_doctor_id, ward } = c.req.valid('json');
    if (incoming_doctor_id === user.id) return c.json({ error: 'cannot hand over to yourself' }, 400);
    const result = await createHandoverSession({
      outgoing_doctor_id: user.id,
      incoming_doctor_id,
      ward,
    });
    if (result === 'bad_incoming') return c.json({ error: 'target doctor not found or inactive' }, 400);
    if (result === 'no_patients') return c.json({ error: 'no active patients to hand over' }, 400);
    await createNotification({
      user_id: incoming_doctor_id,
      type: 'handover.incoming',
      payload: {
        session_id: result.id,
        from_doctor_id: user.id,
        patient_count: result.items.length,
        ward: ward ?? null,
      },
    });
    return c.json(result, 201);
  }
);

handoverSessionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Handover Sessions'],
    request: { query: ListSessionQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(HandoverSessionSchema) } },
        description: 'Handover sessions for the signed-in doctor',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Only doctors can list handover sessions',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.role !== 'doctor') return c.json({ error: 'only doctors can list handover sessions' }, 403);
    const { role } = c.req.valid('query');
    const sessions = await listHandoverSessions(user.id, role ?? 'all');
    return c.json(sessions, 200);
  }
);

handoverSessionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Handover Sessions'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: HandoverSessionDetailSchema } },
        description: 'Session with all items, acknowledgment status, and stale flags',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not your session',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    const session = await getHandoverSession(id);
    if (!session) return c.json({ error: 'not found' }, 404);
    if (session.outgoing_doctor_id !== user.id && session.incoming_doctor_id !== user.id) {
      return c.json({ error: 'not your session' }, 403);
    }
    return c.json(session, 200);
  }
);

const ItemParam = z.object({ id: z.string().uuid() });

handoverSessionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/items/{id}/acknowledge',
    tags: ['Handover Sessions'],
    request: {
      params: ItemParam,
      body: { content: { 'application/json': { schema: AcknowledgeItemBody } }, required: false },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: HandoverAcknowledgmentSchema } },
        description: 'Acknowledged — re-fetch GET /handover-sessions/:id for the updated stale flag',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the incoming doctor for this session',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Item not found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({})) as { notes?: string };
    const result = await acknowledgeHandoverItem(id, user.id, body.notes);
    if (result === 'not_yours') return c.json({ error: 'not the incoming doctor for this session' }, 403);
    if (!result) return c.json({ error: 'item not found' }, 404);
    return c.json(result, 200);
  }
);
