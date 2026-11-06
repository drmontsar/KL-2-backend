import { z } from 'zod';

export const RequestSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  source: z.enum(['emergency', 'opd', 'elective', 'external']),
  diagnosis: z.string(),
  clinical_handover: z.string(),
  requested_unit_id: z.string().uuid(),
  status: z.enum(['pending', 'accepted', 'declined']),
  requested_by: z.string().uuid(),
  requested_at: z.string(),
  resolved_by: z.string().uuid().nullable(),
  resolved_at: z.string().nullable(),
  decline_reason: z.string().nullable(),
  admission_id: z.string().uuid().nullable(),
  opd_visit_id: z.string().uuid().nullable(),
});

export const CreateBody = z.object({
  patient_id: z.string().uuid(),
  source: z.enum(['emergency', 'opd', 'elective', 'external']),
  diagnosis: z.string().trim().min(1).max(5000),
  clinical_handover: z.string().max(10000).default(''),
  requested_unit_id: z.string().uuid(),
});

export const AcceptBody = z.object({
  bed_id: z.string().uuid(),
  consultant_id: z.string().uuid(),
  nurse_id: z.string().uuid(),
});

export const DeclineBody = z.object({ reason: z.string().trim().min(1).max(5000) });

export const ChecklistSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  code: z.string(),
  status: z.enum(['pending', 'completed']),
  completed_by: z.string().uuid().nullable(),
  completed_at: z.string().nullable(),
  evidence: z.string().nullable(),
});

export const CompleteBody = z.object({ evidence: z.string().trim().min(1).max(5000) });

export type AdmissionRequest = z.infer<typeof RequestSchema>;

export type ChecklistItem = z.infer<typeof ChecklistSchema>;

export type CreateBodyInput = z.infer<typeof CreateBody>;

export type AcceptBodyInput = z.infer<typeof AcceptBody>;
