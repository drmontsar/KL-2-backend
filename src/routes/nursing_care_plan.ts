import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import { CreateBody, ItemSchema, UpdateBody } from '../contracts/nursing_care_plan';
import {
  createCarePlanItem,
  getLatestNursingAssessment,
  listCarePlanItems,
  updateCarePlanItem,
  getCarePlanItem,
} from '../db/queries/nursing_care_plan';

import { ErrorSchema, IdParam } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const nursingCarePlanRouter = new OpenAPIHono<{ Variables: Variables }>();

nursingCarePlanRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}/care-plan',
    tags: ['Nursing Care Plan'],
    request: { params: IdParam },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({
              assessment_id: z.string().uuid().nullable(),
              generated: z.array(z.string()),
              items: z.array(ItemSchema),
            }),
          },
        },
        description: 'Current assessment recommendations and care-plan items',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessAdmission(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const [assessment] = await getLatestNursingAssessment(id);
    const items = await listCarePlanItems(id);
    return c.json(
      { assessment_id: assessment?.id ?? null, generated: assessment?.care_plan ?? [], items },
      200,
    );
  },
);

nursingCarePlanRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/care-plan',
    tags: ['Nursing Care Plan'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: CreateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: ItemSchema } },
        description: 'Care-plan item created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission not active',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.nurse') || !(await canAccessAdmission(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const item = await createCarePlanItem(body, user.id, id);
    if (!item) return c.json({ error: 'admission not active' }, 409);
    return c.json(item, 201);
  },
);

nursingCarePlanRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/nursing-care-plan/{id}',
    tags: ['Nursing Care Plan'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: ItemSchema } },
        description: 'Care-plan item updated',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Item resolved, admission inactive, or revision changed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await getCarePlanItem(id);
    if (
      !existing ||
      !hasPermission(user, 'clinical.nurse') ||
      !(await canAccessAdmission(user, existing.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const item = await updateCarePlanItem(body, user.id, id);
    if (!item)
      return c.json({ error: 'item resolved, admission inactive, or revision changed' }, 409);
    return c.json(item, 200);
  },
);
