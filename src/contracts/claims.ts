import { z } from 'zod';

export const Money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);

export const ClaimSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  coverage_id: z.string().uuid(),
  status: z.enum([
    'draft',
    'preauthorization_sent',
    'query_raised',
    'approved',
    'discharge_billed',
  ]),
  currency: z.string(),
  approved_limit: z.string(),
  current_usage: z.string(),
  estimate: z.string(),
  final_approved: z.boolean(),
  enhancement_pending: z.boolean(),
  revision: z.number().int(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const QuerySchema = z.object({
  id: z.string().uuid(),
  claim_id: z.string().uuid(),
  question: z.string(),
  reply: z.string().nullable(),
  raised_by: z.string().uuid(),
  raised_at: z.string(),
  replied_by: z.string().uuid().nullable(),
  replied_at: z.string().nullable(),
});

export const EventSchema = z.object({
  id: z.string().uuid(),
  claim_id: z.string().uuid(),
  type: z.string(),
  note: z.string(),
  actor_id: z.string().uuid(),
  created_at: z.string(),
});

export const CreateBody = z.object({
  admission_id: z.string().uuid(),
  coverage_id: z.string().uuid(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
  estimate: Money.default('0'),
});

export const DepositBody = z.object({
  admission_id: z.string().uuid(),
  amount: Money.refine((value) => Number(value) > 0, 'amount must be positive'),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
  reference: z.string().trim().min(1).max(200),
});

export const DepositSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  amount: z.string(),
  currency: z.string(),
  reference: z.string(),
  recorded_by: z.string().uuid(),
  created_at: z.string(),
});

export const ActionBody = z.object({
  expected_revision: z.number().int().positive(),
  action: z.enum([
    'send_preauthorization',
    'raise_query',
    'reply_query',
    'approve',
    'request_enhancement',
    'update_costs',
    'bill_discharge',
    'final_approve',
  ]),
  note: z.string().trim().max(5000).default(''),
  approved_limit: Money.optional(),
  current_usage: Money.optional(),
  estimate: Money.optional(),
});

export type Claim = z.infer<typeof ClaimSchema>;

export type ClaimQuery = z.infer<typeof QuerySchema>;

export type Event = z.infer<typeof EventSchema>;

export type DepositBodyInput = z.infer<typeof DepositBody>;

export type CreateBodyInput = z.infer<typeof CreateBody>;

export type ActionBodyInput = z.infer<typeof ActionBody>;
