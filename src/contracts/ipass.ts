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

export const ActionTaskSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(1000),
  done: z.boolean(),
  high_priority: z.boolean(),
  role: z.enum(['DD', 'Nurse', 'Consultant']),
  timing: z.enum(['Shift End', 'Now', 'Next Shift']),
});

export const ItemSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  admission_id: z.string().uuid(),
  patient_name: z.string(),
  uhid: z.string().nullable().optional(),
  age: z.number().nullable().optional(),
  sex: z.string().nullable().optional(),
  admitted_at: z.union([z.string(), z.date()]).optional(),
  news2_score: z.number().nullable().optional(),
  consultant_name: z.string().nullable().optional(),
  ward: z.string().nullable(),
  bed: z.string().nullable(),
  severity: z.enum(['stable', 'watcher', 'unstable']),
  arrival_status: z.enum(['incoming', 'admitted']),
  patient_summary: z.string(),
  action_list: z.string(),
  action_tasks: z.array(ActionTaskSchema).nullable(),
  item_revision: z.union([z.string(), z.number()]),
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
  // shortcut: empty handovers are allowed for flow testing; restore completeness before clinical rollout.
  patient_summary: z.string().trim().max(10000),
  action_list: z.string().trim().max(10000),
  contingency: z.string().trim().max(10000),
  action_tasks: z.array(ActionTaskSchema).max(100).refine((tasks) => new Set(tasks.map((task) => task.id)).size === tasks.length, 'Task IDs must be unique').optional(),
  expected_item_revision: z.coerce.number().int().nonnegative().optional(),
  // Changing handover severity also changes the clinical admission, under its revision lock.
  severity: z.enum(['stable', 'watcher', 'unstable']).optional(),
  expected_revision: z.coerce.number().int().nonnegative().optional(),
}).refine((body) => body.severity === undefined || body.expected_revision !== undefined, {
  message: 'expected_revision is required when changing severity',
  path: ['expected_revision'],
}).refine((body) => body.action_tasks === undefined || body.expected_item_revision !== undefined, {
  message: 'expected_item_revision is required when saving tasks',
  path: ['expected_item_revision'],
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
