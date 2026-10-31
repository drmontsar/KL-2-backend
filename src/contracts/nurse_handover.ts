import { z } from 'zod';

export const SessionSchema = z.object({
  id: z.string().uuid(),
  outgoing_nurse_id: z.string().uuid(),
  incoming_nurse_id: z.string().uuid(),
  status: z.enum(['draft', 'sent', 'completed', 'cancelled']),
  created_at: z.string(),
  sent_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

export const Checklist = z.object({
  identity_band: z.literal(true),
  allergy_band: z.literal(true),
  pump_rates: z.literal(true),
  lines_and_drains: z.literal(true),
  airway_checked_or_not_applicable: z.literal(true),
  alarms: z.literal(true),
  oxygen_and_suction: z.literal(true),
  fall_precautions: z.literal(true),
  pressure_areas: z.literal(true),
});

export const ItemSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  admission_id: z.string().uuid(),
  patient_name: z.string(),
  ward: z.string().nullable(),
  bed: z.string().nullable(),
  snapshot: z.record(z.string(), z.unknown()),
  handover_notes: z.string(),
  status: z.enum(['draft', 'accepted', 'cancelled']),
  checklist: Checklist.nullable(),
  discrepancies: z.string().nullable(),
  accepted_at: z.string().nullable(),
});

export const DetailSchema = z.object({ session: SessionSchema, items: z.array(ItemSchema) });

export const CreateBody = z.object({
  incoming_nurse_id: z.string().uuid(),
  ward: z.string().trim().min(1).optional(),
});

export const ItemBody = z.object({ handover_notes: z.string().max(10000) });

export const AcceptBody = z.object({
  checklist: Checklist,
  discrepancies: z.string().trim().max(5000).optional(),
});

export const QuestionBody = z.object({ body: z.string().trim().min(1).max(5000) });

export const QuestionSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  author_id: z.string().uuid(),
  body: z.string(),
  created_at: z.string(),
});

export type Session = z.infer<typeof SessionSchema>;

export type Item = z.infer<typeof ItemSchema>;

export type Question = z.infer<typeof QuestionSchema>;

export type CreateBodyInput = z.infer<typeof CreateBody>;

export type AcceptBodyInput = z.infer<typeof AcceptBody>;

export type QuestionBodyInput = z.infer<typeof QuestionBody>;
