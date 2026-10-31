import { z } from 'zod';

export const PlanSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  discharge_type: z.enum(['home', 'referral', 'lama']),
  status: z.enum(['pending_approval', 'approved', 'completed', 'cancelled']),
  planned_at: z.string(),
  condition: z.string(),
  follow_up: z.string(),
  form_version_id: z.string().uuid().nullable(),
  summary: z.string().nullable(),
  summary_signed_by: z.string().uuid().nullable(),
  summary_signed_at: z.string().nullable(),
  requested_by: z.string().uuid(),
  requested_at: z.string(),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  completed_by: z.string().uuid().nullable(),
  completed_at: z.string().nullable(),
  revision: z.number().int(),
});

export const TaskSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  code: z.enum([
    'summary',
    'pending_results',
    'medication_reconciliation',
    'nursing',
    'billing',
    'insurance',
    'payment',
  ]),
  status: z.enum(['pending', 'completed']),
  evidence: z.string().nullable(),
  completed_by: z.string().uuid().nullable(),
  completed_at: z.string().nullable(),
});

export const CreateBody = z.object({
  admission_id: z.string().uuid(),
  discharge_type: z.enum(['home', 'referral', 'lama']),
  planned_at: z.string().datetime({ offset: true }),
  condition: z.string().trim().min(1).max(5000),
  follow_up: z.string().trim().min(1).max(5000),
  form_version_id: z.string().uuid().optional(),
});

export const SummaryBody = z.object({ summary: z.string().trim().min(1).max(30000) });

export const TaskBody = z.object({ evidence: z.string().trim().min(1).max(10000) });

export type Plan = z.infer<typeof PlanSchema>;

export type Task = z.infer<typeof TaskSchema>;

export type CreateBodyInput = z.infer<typeof CreateBody>;
