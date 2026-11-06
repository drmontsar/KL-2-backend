import { z } from 'zod';

export const SessionSchema = z.object({
  id: z.string().uuid(),
  outgoing_doctor_id: z.string().uuid(),
  incoming_doctor_id: z.string().uuid().nullable(),
  ward: z.string().nullable(),
  status: z.enum(['draft', 'sent', 'completed', 'cancelled']),
  created_at: z.string(),
  sent_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

export const ItemSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  admission_id: z.string().uuid(),
  patient_name: z.string(),
  ward: z.string().nullable(),
  bed: z.string().nullable(),
  severity: z.enum(['stable', 'watcher', 'unstable']),
  arrival_status: z.enum(['incoming', 'admitted']),
  patient_summary: z.string(),
  action_list: z.string(),
  contingency: z.string(),
  status: z.enum(['draft', 'signed', 'accepted', 'cancelled']),
  snapshot_revision: z.union([z.string(), z.number()]),
  signed_at: z.string().nullable(),
  readback: z.string().nullable(),
  receiver_view: z.string().nullable(),
  stale_acknowledged: z.boolean(),
  reviewed_by: z.string().uuid().nullable(),
  accepted_at: z.string().nullable(),
});

export const DetailSchema = z.object({ session: SessionSchema, items: z.array(ItemSchema) });

export const QuestionSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  author_id: z.string().uuid(),
  body: z.string(),
  created_at: z.string(),
});

export const CreateBody = z.object({
  ward: z.string().trim().min(1).optional(),
});

export const ItemBody = z.object({
  patient_summary: z.string().trim().min(1).max(10000),
  action_list: z.string().trim().min(1).max(10000),
  contingency: z.string().trim().min(1).max(10000),
});

export const AcceptBody = z.object({
  receiver_view: z.string().trim().min(1).max(10000),
  readback: z.string().trim().min(1).max(10000).optional(),
  acknowledge_stale: z.boolean().optional(),
});

export const QuestionBody = z.object({ body: z.string().trim().min(1).max(5000) });

export type Session = z.infer<typeof SessionSchema>;

export type Item = z.infer<typeof ItemSchema>;

export type Question = z.infer<typeof QuestionSchema>;

export type CreateBodyInput = z.infer<typeof CreateBody>;

export type ItemBodyInput = z.infer<typeof ItemBody>;

export type QuestionBodyInput = z.infer<typeof QuestionBody>;
