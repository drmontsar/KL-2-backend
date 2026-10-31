import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import { CreateBody, DeclineBody, TransferSchema } from '../contracts/consultant_care_transfers';
import {
  transitionConsultantCareTransfer,
  requestConsultantCareTransfer,
  listConsultantCareTransfers,
} from '../db/queries/consultant_care_transfers';

import { ErrorSchema, IdParam } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };
export const consultantCareTransfersRouter = new OpenAPIHono<{ Variables: Variables }>();

consultantCareTransfersRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Consultant Care Transfers'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(TransferSchema) } },
        description: 'Transfers involving the current clinician',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);
    const rows = await listConsultantCareTransfers(user.id);
    return c.json(rows, 200);
  },
);

consultantCareTransfersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Consultant Care Transfers'],
    request: { body: { content: { 'application/json': { schema: CreateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: TransferSchema } },
        description: 'Care transfer requested',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Consultant unavailable or transfer already pending',
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

    const row = await requestConsultantCareTransfer(user.id, body);
    if (!row) return c.json({ error: 'current or receiving consultant unavailable' }, 409);
    return c.json(row, 201);
  },
);

for (const action of ['release', 'accept', 'decline', 'withdraw'] as const) {
  consultantCareTransfersRouter.openapi(
    createRoute({
      method: 'post',
      path: `/{id}/${action}`,
      tags: ['Consultant Care Transfers'],
      request: {
        params: IdParam,
        ...(action === 'decline'
          ? { body: { content: { 'application/json': { schema: DeclineBody } } } }
          : {}),
      },
      responses: {
        200: {
          content: { 'application/json': { schema: TransferSchema } },
          description: 'Care transfer updated',
        },
        400: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Decline reason is required',
        },
        403: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Not found or access denied',
        },
        409: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Invalid transition or current consultant changed',
        },
      },
    }),
    async (c) => {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      if (!hasPermission(user, 'clinical.doctor'))
        return c.json({ error: 'doctor access required' }, 403);
      let reason: string | null = null;
      if (action === 'decline') {
        const parsed = DeclineBody.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return c.json({ error: 'decline reason is required' }, 400);
        reason = parsed.data.reason;
      }
      const result = await transitionConsultantCareTransfer(id, action, user.id, reason);
      if (result === 'forbidden') return c.json({ error: 'not found or forbidden' }, 403);
      if (result === 'conflict')
        return c.json({ error: 'invalid transition or consultant changed' }, 409);
      return c.json(result, 200);
    },
  );
}
