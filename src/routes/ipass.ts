import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  AcceptBody,
  CreateBody,
  DetailSchema,
  ItemBody,
  ItemSchema,
  QuestionBody,
  QuestionSchema,
  SessionSchema,
} from '../contracts/ipass';
import {
  acceptIpassItem,
  addIpassQuestion,
  cancelIpassSession,
  createIpassSession,
  getIpassSession,
  getIpassSessionById,
  getIpassSessionForItem,
  getOutgoingIpassItemOwner,
  listIpassItems,
  listIpassQuestions,
  listIpassSessions,
  refreshIpassItem,
  sendIpassSession,
  signIpassItem,
  updateIpassItem,
} from '../db/queries/ipass';

import { ErrorSchema, IdParam } from '../contracts/common';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const ipassRouter = new OpenAPIHono<{ Variables: Variables }>();

ipassRouter.use('*', async (c, next) => {
  if (c.get('user').job_role !== 'duty_doctor')
    return c.json({ error: 'duty doctor access required' }, 403);
  await next();
});

ipassRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['I-PASS'],
    request: { body: { content: { 'application/json': { schema: CreateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: DetailSchema } },
        description: 'Draft shift handover created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'No active patients in the selected ward',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (user.role !== 'doctor') return c.json({ error: 'doctor access required' }, 403);

    const result = await createIpassSession(body, user.id);
    if (!result) return c.json({ error: 'no active patients to hand over' }, 409);
    return c.json(result, 201);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['I-PASS'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(SessionSchema) } },
        description: 'My handover sessions',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    return c.json(await listIpassSessions(user.id), 200);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['I-PASS'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: DetailSchema } },
        description: 'Handover session',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not a participant',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const [session] = await getIpassSession(id, user.id);
    if (!session) return c.json({ error: 'not found or forbidden' }, 403);
    const items = await listIpassItems(id);
    return c.json({ session, items }, 200);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/items/{id}',
    tags: ['I-PASS'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ItemBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: ItemSchema } },
        description: 'Draft handover item updated',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the outgoing doctor',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Session no longer editable or patient is no longer available',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [owner] = await getOutgoingIpassItemOwner(id);
    if (!owner || owner.outgoing_doctor_id !== user.id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const row = await updateIpassItem(body, id, user.id);
    if (!row)
      return c.json({ error: 'session no longer editable or patient is no longer available' }, 409);
    return c.json(row, 200);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'post',
    path: '/items/{id}/sign',
    tags: ['I-PASS'],
    request: { params: IdParam },
    responses: {
      200: { content: { 'application/json': { schema: ItemSchema } }, description: 'Item signed' },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the outgoing doctor',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Item incomplete or patient changed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const [owner] = await getOutgoingIpassItemOwner(id);
    if (!owner || owner.outgoing_doctor_id !== user.id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const row = await signIpassItem(id, user.id);
    if (!row) return c.json({ error: 'item incomplete or patient changed' }, 409);
    return c.json(row, 200);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/send',
    tags: ['I-PASS'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: SessionSchema } },
        description: 'Handover sent',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the outgoing doctor',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Incomplete, stale, or already sent',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const [owner] = await getIpassSessionById(id);
    if (!owner || owner.outgoing_doctor_id !== user.id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await sendIpassSession(id, user.id);
    if (!result) return c.json({ error: 'incomplete, stale, or already sent' }, 409);
    return c.json(result, 200);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'post',
    path: '/items/{id}/accept',
    tags: ['I-PASS'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: AcceptBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: ItemSchema } },
        description: 'Patient reviewed by a duty doctor; no ownership transfer',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the receiving doctor',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Receiver view/read-back required, item stale, or already reviewed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { receiver_view, readback, acknowledge_stale } = c.req.valid('json');
    const result = await acceptIpassItem(id, user.id, receiver_view, readback, acknowledge_stale);
    if (!result)
      return c.json({ error: 'receiver view/read-back required, item stale (set acknowledge_stale after reviewing changes), or already reviewed' }, 409);
    return c.json(result, 200);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'post',
    path: '/items/{id}/questions',
    tags: ['I-PASS'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: QuestionBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: QuestionSchema } },
        description: 'Handover question sent',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not a handover participant',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Handover not active',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [session] = await getIpassSessionForItem(id);
    if (!session || (session.status === 'draft' && session.outgoing_doctor_id !== user.id))
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await addIpassQuestion(id, user.id, body);
    if (!result) return c.json({ error: 'handover not active' }, 409);
    return c.json(result, 201);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'post',
    path: '/items/{id}/refresh',
    tags: ['I-PASS'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ItemBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: ItemSchema } },
        description: 'Signed handover refreshed after patient changes',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the outgoing doctor',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Item unavailable or patient no longer admitted',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [owner] = await getOutgoingIpassItemOwner(id);
    if (!owner || owner.outgoing_doctor_id !== user.id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await refreshIpassItem(body, id, user.id);
    if (!result) return c.json({ error: 'item unavailable or patient no longer admitted' }, 409);
    return c.json(result, 200);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'get',
    path: '/items/{id}/questions',
    tags: ['I-PASS'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(QuestionSchema) } },
        description: 'Handover discussion',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not a handover participant',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const [session] = await getIpassSessionForItem(id);
    if (!session || (session.status === 'draft' && session.outgoing_doctor_id !== user.id))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listIpassQuestions(id), 200);
  },
);

ipassRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['I-PASS'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: SessionSchema } },
        description: 'Remaining handover items cancelled; previously reviewed items remain recorded',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the outgoing doctor',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Session already completed or cancelled',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const [owner] = await getIpassSessionById(id);
    if (!owner || owner.outgoing_doctor_id !== user.id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await cancelIpassSession(id, user.id);
    if (!result) return c.json({ error: 'session already completed or cancelled' }, 409);
    return c.json(result, 200);
  },
);
