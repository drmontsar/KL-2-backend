import { z } from 'zod';

export const TransferSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  requested_by: z.string().uuid(),
  from_consultant_id: z.string().uuid(),
  to_consultant_id: z.string().uuid(),
  reason: z.string(),
  discussed_with_current: z.boolean(),
  patient_family_informed: z.boolean(),
  status: z.enum(['pending_release', 'pending_acceptance', 'accepted', 'declined', 'withdrawn']),
  released_at: z.string().nullable(),
  resolved_at: z.string().nullable(),
  resolution_reason: z.string().nullable(),
  created_at: z.string(),
});

export const CreateBody = z.object({
  admission_id: z.string().uuid(),
  to_consultant_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(5000),
  discussed_with_current: z.literal(true),
  patient_family_informed: z.literal(true),
});

export const DeclineBody = z.object({ reason: z.string().trim().min(1).max(5000) });

export type CreateBodyInput = z.infer<typeof CreateBody>;
