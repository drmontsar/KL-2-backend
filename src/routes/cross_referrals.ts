import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import {
  CreateBody,
  OpinionBody,
  Query,
  RecommendationOrderBody,
  ReferralSchema,
} from '../contracts/cross_referrals';
import {
  transitionCrossReferral,
  createCrossReferral,
  recordReferralOpinion,
  createReferralOrder,
  getCrossReferral,
  markReferralSeen,
  listCrossReferrals,
} from '../db/queries/cross_referrals';

import { ErrorSchema, IdParam, OrderSchema } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };
export const crossReferralsRouter = new OpenAPIHono<{ Variables: Variables }>();

crossReferralsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Cross Referrals'],
    request: { query: Query },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(ReferralSchema) } },
        description: 'Referrals visible to current staff member',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Clinical access required',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);
    const query = c.req.valid('query');
    if (query.admission_id && !(await canAccessAdmission(user, query.admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const rows = await listCrossReferrals(query, user);
    return c.json(rows, 200);
  },
);

crossReferralsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Cross Referrals'],
    request: { body: { content: { 'application/json': { schema: CreateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: ReferralSchema } },
        description: 'Referral sent',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Consultant unavailable or duplicate open referral',
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

    const row = await createCrossReferral(user.id, body);
    if (!row) return c.json({ error: 'consultant or admission unavailable' }, 409);
    return c.json(row, 201);
  },
);

crossReferralsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/seen',
    tags: ['Cross Referrals'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: ReferralSchema } },
        description: 'Referral marked seen',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Consultant access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Referral is not awaiting review',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (user.job_role !== 'consultant') return c.json({ error: 'consultant access required' }, 403);
    const row = await markReferralSeen(id, user.id);
    if (!row) return c.json({ error: 'referral is not awaiting review' }, 409);
    return c.json(row, 200);
  },
);

crossReferralsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/opinion',
    tags: ['Cross Referrals'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: OpinionBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: ReferralSchema } },
        description: 'Opinion recorded',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Consultant access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Referral is not awaiting an opinion',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (user.job_role !== 'consultant') return c.json({ error: 'consultant access required' }, 403);
    const row = await recordReferralOpinion(body, id, user.id);
    if (!row) return c.json({ error: 'referral is not awaiting an opinion' }, 409);
    return c.json(row, 200);
  },
);

crossReferralsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/orders',
    tags: ['Cross Referrals'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: RecommendationOrderBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: OrderSchema } },
        description: 'Draft order created from referral recommendation',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Referral has no opinion',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [referral] = await getCrossReferral(id);
    if (
      !referral ||
      !hasPermission(user, 'clinical.doctor') ||
      !(await canAccessAdmission(user, referral.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const order = await createReferralOrder(body, user.id, id);
    if (!order) return c.json({ error: 'referral has no active opinion' }, 409);
    return c.json(order, 201);
  },
);

for (const action of ['acknowledge', 'close', 'withdraw'] as const) {
  crossReferralsRouter.openapi(
    createRoute({
      method: 'post',
      path: `/{id}/${action}`,
      tags: ['Cross Referrals'],
      request: { params: IdParam },
      responses: {
        200: {
          content: { 'application/json': { schema: ReferralSchema } },
          description: 'Referral updated',
        },
        403: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Not found or access denied',
        },
        409: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Invalid referral state',
        },
      },
    }),
    async (c) => {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      const [existing] = await getCrossReferral(id);
      if (
        !existing ||
        !hasPermission(user, 'clinical.doctor') ||
        !(await canAccessAdmission(user, existing.admission_id))
      )
        return c.json({ error: 'not found or forbidden' }, 403);
      const row = await transitionCrossReferral(action, user.id, id);
      if (!row) return c.json({ error: 'invalid referral state' }, 409);
      return c.json(row, 200);
    },
  );
}
