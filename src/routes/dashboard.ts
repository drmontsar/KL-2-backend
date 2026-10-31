import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { ErrorSchema, IdParam } from '../contracts/common';
import { getCensusCards, getHeaderSummary, getWardSummary } from '../db/queries/dashboard';
import type { User } from '../db/queries/users';

type Variables = { user: User };
const WardSummarySchema = z.object({
  news_critical: z.number().int(),
  news_warning: z.number().int(),
  stat_orders: z.number().int(),
  pending_orders: z.number().int(),
  active_shifts: z.number().int(),
  unsigned_handovers: z.number().int(),
  tpa_queries: z.number().int(),
  master_warnings: z.number().int(),
  master_cautions: z.number().int(),
  claim_data_visible: z.boolean(),
});
const HeaderSummarySchema = z.object({
  admission_id: z.string().uuid(),
  patient: z.object({
    id: z.string().uuid(),
    name: z.string(),
    uhid: z.string(),
    age: z.number().int(),
    sex: z.enum(['male', 'female', 'other', 'unknown']).nullable(),
    allergies: z.array(
      z.object({
        allergen: z.string(),
        reaction: z.string().optional(),
        severity: z.enum(['mild', 'moderate', 'severe']).optional(),
      }),
    ),
  }),
  bed: z.object({
    id: z.string().uuid().nullable(),
    label: z.string().nullable(),
    ward: z.string().nullable(),
    unit_id: z.string().uuid().nullable(),
  }),
  news2: z
    .object({
      score: z.number().int(),
      escalation: z.enum(['low', 'low-medium', 'medium', 'high']).nullable(),
      recorded_at: z.string(),
      component_scores: z.record(z.string(), z.number()).nullable(),
      rule_version: z.string().nullable(),
    })
    .nullable(),
  consultant: z
    .object({ id: z.string().uuid(), name: z.string(), specialty: z.string().nullable() })
    .nullable(),
  assigned_doctor: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  assigned_nurse: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  payer: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  claim: z
    .object({
      id: z.string().uuid(),
      status: z.string(),
      current_usage: z.string(),
      approved_limit: z.string(),
      currency: z.string(),
    })
    .nullable(),
  claim_data_visible: z.boolean(),
  counts: z.object({
    pending_orders: z.number().int(),
    stat_orders: z.number().int(),
    active_alerts: z.number().int(),
    active_referrals: z.number().int(),
    active_shifts: z.number().int(),
    unsigned_handovers: z.number().int(),
    tpa_queries: z.number().int(),
    pending_discharge_tasks: z.number().int(),
  }),
});

export const dashboardRouter = new OpenAPIHono<{ Variables: Variables }>();
export const admissionHeaderRouter = new OpenAPIHono<{ Variables: Variables }>();

dashboardRouter.openapi(
  createRoute({
    method: 'get',
    path: '/census-cards',
    tags: ['Dashboard'],
    request: {
      query: z.object({
        ids: z
          .string()
          .transform((value) => value.split(','))
          .pipe(z.array(z.string().uuid()).min(1).max(100)),
      }),
    },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.array(
              z.object({
                admission_id: z.string().uuid(),
                dob: z.string(),
                sex: z.string().nullable(),
                has_allergies: z.boolean(),
                diagnosis: z.string().nullable(),
                doctor_name: z.string().nullable(),
                scores: z.array(z.number().int()),
                open_alerts: z.number().int(),
              }),
            ),
          },
        },
        description: 'Access-scoped patient census summaries',
      },
    },
  }),
  async (c) => c.json(await getCensusCards(c.req.valid('query').ids, c.get('user')), 200),
);

dashboardRouter.openapi(
  createRoute({
    method: 'get',
    path: '/ward-summary',
    tags: ['Dashboard'],
    request: { query: z.object({ unit_id: z.string().uuid() }) },
    responses: {
      200: {
        content: { 'application/json': { schema: WardSummarySchema } },
        description: 'Scoped ward summary; active_shifts counts patient movements',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Unit not found or access denied',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.role !== 'doctor' && user.role !== 'nurse' && user.job_role !== 'administrator') {
      return c.json({ error: 'unit not found or forbidden' }, 403);
    }
    const summary = await getWardSummary(c.req.valid('query').unit_id, user);
    if (!summary) return c.json({ error: 'unit not found or forbidden' }, 403);
    return c.json(summary, 200);
  },
);

admissionHeaderRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/header-summary',
    tags: ['Dashboard'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: HeaderSummarySchema } },
        description: 'Patient banner and scoped actionable counts',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission not found or access denied',
      },
    },
  }),
  async (c) => {
    const summary = await getHeaderSummary(c.req.valid('param').id, c.get('user'));
    if (!summary) return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(summary, 200);
  },
);
