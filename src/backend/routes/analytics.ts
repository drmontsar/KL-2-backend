import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { User } from '../db/queries/users';
import { getDoctorAnalytics } from '../db/queries/analytics';
import { ErrorSchema } from './schemas';

type Variables = { user: User };

const DoctorAnalyticsSchema = z.object({
  total_active: z.number().int(),
  severity: z.object({
    unstable: z.number().int(),
    watcher:  z.number().int(),
    stable:   z.number().int(),
  }),
  by_ward: z.array(z.object({
    ward:  z.string(),
    count: z.number().int(),
  })),
  nurse_coverage: z.object({
    assigned:   z.number().int(),
    unassigned: z.number().int(),
  }),
  length_of_stay: z.array(z.object({
    admission_id: z.string().uuid(),
    patient_name: z.string(),
    ward:         z.string().nullable(),
    bed:          z.string().nullable(),
    days:         z.number().int(),
  })),
  vitals_alerts: z.array(z.object({
    admission_id: z.string().uuid(),
    patient_name: z.string(),
    ward:         z.string().nullable(),
    bed:          z.string().nullable(),
    flags:        z.array(z.string()),
  })),
  pending_tasks_total: z.number().int(),
  career: z.object({
    total_handled:    z.number().int(),
    total_discharged: z.number().int(),
  }),
  case_mix: z.array(z.object({
    description: z.string(),
    count:       z.number().int(),
  })),
  handover_stats: z.object({
    sessions_received: z.number().int(),
    sessions_given:    z.number().int(),
    received_from: z.array(z.object({
      doctor_id:   z.string().uuid(),
      doctor_name: z.string(),
      count:       z.number().int(),
    })),
    given_to: z.array(z.object({
      doctor_id:   z.string().uuid(),
      doctor_name: z.string(),
      count:       z.number().int(),
    })),
  }),
  transfer_stats: z.object({
    received: z.number().int(),
    given:    z.number().int(),
  }),
});

export const analyticsRouter = new OpenAPIHono<{ Variables: Variables }>();

analyticsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/my',
    tags: ['Analytics'],
    responses: {
      200: {
        content: { 'application/json': { schema: DoctorAnalyticsSchema } },
        description: 'Analytics for the signed-in doctor\'s active roster',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Only doctors have analytics',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.role !== 'doctor') return c.json({ error: 'only doctors have analytics' }, 403);
    const data = await getDoctorAnalytics(user.id);
    return c.json(data, 200);
  }
);
