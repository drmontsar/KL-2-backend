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
} from '../contracts/nurse_handover';
import {
  acceptNurseHandoverItem,
  addNurseHandoverQuestion,
  cancelNurseHandover,
  createNurseHandover,
  getNurseHandover,
  getNurseHandoverById,
  getNurseHandoverForItem,
  getNurseHandoverItemOwner,
  getNurseHandoverItemRecipient,
  listNurseHandoverItems,
  listNurseHandoverQuestions,
  listNurseHandovers,
  sendNurseHandover,
  updateNurseHandoverItem,
} from '../db/queries/nurse_handover';

import { ErrorSchema, IdParam } from '../contracts/common';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const nurseHandoverRouter = new OpenAPIHono<{ Variables: Variables }>();

nurseHandoverRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Nurse Handover'],
    request: { body: { content: { 'application/json': { schema: CreateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: DetailSchema } },
        description: 'Bedside handover draft created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Recipient unavailable, no assigned patients, or handover already open',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (user.role !== 'nurse') return c.json({ error: 'nurse access required' }, 403);
    if (user.id === body.incoming_nurse_id)
      return c.json({ error: 'recipient must be another nurse' }, 409);

    const result = await createNurseHandover(body, user.id);
    if (!result) return c.json({ error: 'recipient unavailable or no assigned patients' }, 409);
    return c.json(result, 201);
  },
);

nurseHandoverRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Nurse Handover'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(SessionSchema) } },
        description: 'My bedside handovers',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    return c.json(await listNurseHandovers(user.id), 200);
  },
);

nurseHandoverRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Nurse Handover'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: DetailSchema } },
        description: 'Handover with patient snapshots',
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
    const [session] = await getNurseHandover(id, user.id);
    if (!session) return c.json({ error: 'not found or forbidden' }, 403);
    const items = await listNurseHandoverItems(id);
    return c.json({ session, items }, 200);
  },
);

nurseHandoverRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/items/{id}',
    tags: ['Nurse Handover'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ItemBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: ItemSchema } },
        description: 'Handover notes updated',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the outgoing nurse',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Handover not editable',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [owner] = await getNurseHandoverItemOwner(id);
    if (!owner || owner.outgoing_nurse_id !== user.id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const row = await updateNurseHandoverItem(body.handover_notes, id, user.id);
    if (!row) return c.json({ error: 'handover not editable' }, 409);
    return c.json(row, 200);
  },
);

nurseHandoverRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/send',
    tags: ['Nurse Handover'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: SessionSchema } },
        description: 'Handover sent',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the outgoing nurse',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Patient assignment changed or session not draft',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const [owner] = await getNurseHandoverById(id);
    if (!owner || owner.outgoing_nurse_id !== user.id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await sendNurseHandover(id, user.id);
    if (!result) return c.json({ error: 'patient assignment changed or session not draft' }, 409);
    return c.json(result, 200);
  },
);

nurseHandoverRouter.openapi(
  createRoute({
    method: 'post',
    path: '/items/{id}/accept',
    tags: ['Nurse Handover'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: AcceptBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: ItemSchema } },
        description: 'Bedside checks complete; responsibility transferred',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the receiving nurse',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Handover not active or assignment changed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [owner] = await getNurseHandoverItemRecipient(id);
    if (!owner || owner.incoming_nurse_id !== user.id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await acceptNurseHandoverItem(id, user.id, body);
    if (!result) return c.json({ error: 'handover not active or assignment changed' }, 409);
    return c.json(result, 200);
  },
);

nurseHandoverRouter.openapi(
  createRoute({
    method: 'post',
    path: '/items/{id}/questions',
    tags: ['Nurse Handover'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: QuestionBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: QuestionSchema } },
        description: 'Bedside handover question sent',
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
    const [session] = await getNurseHandoverForItem(id);
    if (
      !session ||
      (session.incoming_nurse_id !== user.id && session.outgoing_nurse_id !== user.id)
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await addNurseHandoverQuestion(id, user.id, body);
    if (!result) return c.json({ error: 'handover not active' }, 409);
    return c.json(result, 201);
  },
);

nurseHandoverRouter.openapi(
  createRoute({
    method: 'get',
    path: '/items/{id}/questions',
    tags: ['Nurse Handover'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(QuestionSchema) } },
        description: 'Bedside handover discussion',
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
    const [session] = await getNurseHandoverForItem(id);
    if (
      !session ||
      (session.incoming_nurse_id !== user.id && session.outgoing_nurse_id !== user.id) ||
      (session.status === 'draft' && session.incoming_nurse_id === user.id)
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listNurseHandoverQuestions(id), 200);
  },
);

nurseHandoverRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['Nurse Handover'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: SessionSchema } },
        description: 'Remaining items cancelled; accepted assignments remain transferred',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not the outgoing nurse',
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
    const [owner] = await getNurseHandoverById(id);
    if (!owner || owner.outgoing_nurse_id !== user.id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await cancelNurseHandover(id, user.id);
    if (!result) return c.json({ error: 'session already completed or cancelled' }, 409);
    return c.json(result, 200);
  },
);
