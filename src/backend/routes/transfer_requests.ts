import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { User } from '../db/queries/users';
import {
  acceptTransferRequest,
  listTransferRequests,
  rejectTransferRequest,
} from '../db/queries/transfer_requests';
import { createNotification } from '../db/queries/notifications';
import { AdmissionSchema, ErrorSchema, IdParam, TransferRequestSchema } from './schemas';

type Variables = { user: User };

export const transferRequestsRouter = new OpenAPIHono<{ Variables: Variables }>();

transferRequestsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Transfer Requests'],
    request: {
      query: z.object({
        role:   z.enum(['incoming', 'outgoing']),
        status: z.literal('pending').optional(),
      }),
    },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(TransferRequestSchema) } },
        description: 'Transfer requests for the signed-in doctor',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Only doctors have transfer requests',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.role !== 'doctor') return c.json({ error: 'only doctors have transfer requests' }, 403);
    const { role, status } = c.req.valid('query');
    const requests = await listTransferRequests(user.id, role, status);
    return c.json(requests, 200);
  }
);

transferRequestsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/accept',
    tags: ['Transfer Requests'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Transfer accepted — admission reassigned',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not your request to accept',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Request already resolved or admission changed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const result = await acceptTransferRequest(id, user.id);
    if (result === 'not_yours') return c.json({ error: 'not your request' }, 403);
    if (result === 'not_pending') return c.json({ error: 'request already resolved' }, 409);
    if (result === 'conflict') return c.json({ error: 'admission was already reassigned' }, 409);
    await createNotification({
      user_id: result.request.from_doctor_id,
      type: 'transfer.accepted',
      payload: {
        request_id: id,
        admission_id: result.admission.id,
        patient_name: (result.admission as { patient_name?: string }).patient_name ?? '',
      },
    });
    return c.json(result.admission, 200);
  }
);

transferRequestsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/reject',
    tags: ['Transfer Requests'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: TransferRequestSchema } },
        description: 'Transfer rejected — patient stays with original doctor',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not your request to reject',
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
    const result = await rejectTransferRequest(id, user.id);
    if (result === 'not_yours') return c.json({ error: 'not your request' }, 403);
    if (result === 'not_pending') return c.json({ error: 'request already resolved' }, 409);
    await createNotification({
      user_id: result.from_doctor_id,
      type: 'transfer.rejected',
      payload: {
        request_id: id,
        admission_id: result.admission_id,
      },
    });
    return c.json(result, 200);
  }
);
