import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  ActionBody,
  ClaimSchema,
  CreateBody,
  DepositBody,
  DepositSchema,
  EventSchema,
  QuerySchema,
} from '../contracts/claims';
import {
  applyClaimAction,
  canAccessClaim,
  createClaim,
  getClaim,
  getClaimsClaimsEvents,
  getClaimsClaimsQueries,
  listClaims,
  recordDeposit,
} from '../db/queries/claims';

import { ErrorSchema, IdParam } from '../contracts/common';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const claimsRouter = new OpenAPIHono<{ Variables: Variables }>();

claimsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/deposits',
    tags: ['Claims'],
    request: { body: { content: { 'application/json': { schema: DepositBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: DepositSchema } },
        description: 'Manual demo deposit recorded',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission unavailable or deposit reference already recorded',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (
      !['administrator', 'billing_insurance'].includes(user.job_role) ||
      !(await canAccessClaim(user, body.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);

    const deposit = await recordDeposit(body, user.id);
    if (!deposit) return c.json({ error: 'admission unavailable' }, 409);
    return c.json(deposit, 201);
  },
);

claimsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Claims'],
    request: { body: { content: { 'application/json': { schema: CreateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: ClaimSchema } },
        description: 'Manual demo claim created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Coverage invalid or claim exists',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (
      !['administrator', 'billing_insurance'].includes(user.job_role) ||
      !(await canAccessClaim(user, body.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);

    const claim = await createClaim(body, user.id);
    if (!claim) return c.json({ error: 'coverage does not belong to an active admission' }, 409);
    return c.json(claim, 201);
  },
);

claimsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Claims'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(ClaimSchema) } },
        description: 'Claims visible to current user',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const rows = await listClaims(user);
    return c.json(rows, 200);
  },
);

claimsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Claims'],
    request: { params: IdParam },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({
              claim: ClaimSchema,
              queries: z.array(QuerySchema),
              events: z.array(EventSchema),
            }),
          },
        },
        description: 'Claim history',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const [claim] = await getClaim(id);
    if (!claim || !(await canAccessClaim(c.get('user'), claim.admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const [queries, events] = await Promise.all([
      getClaimsClaimsQueries(id),
      getClaimsClaimsEvents(id),
    ]);
    return c.json({ claim, queries, events }, 200);
  },
);

claimsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/actions',
    tags: ['Claims'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ActionBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: ClaimSchema } },
        description: 'Manual demo claim action recorded',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Invalid transition, missing details, or revision conflict',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await getClaim(id);
    if (!existing || !(await canAccessClaim(user, existing.admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    if (
      !['administrator', 'billing_insurance'].includes(user.job_role) &&
      !(user.role === 'doctor' && body.action === 'reply_query')
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await applyClaimAction(id, body, user.id);
    if (!result)
      return c.json({ error: 'invalid transition, missing details, or revision conflict' }, 409);
    return c.json(result, 200);
  },
);
