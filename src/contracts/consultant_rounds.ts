import { z } from 'zod';

export const RoundSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  consultant_id: z.string().uuid(),
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
  note_id: z.string().uuid(),
  signed_at: z.string(),
});

export const RoundOrder = z.object({
  kind: z.enum([
    'medication',
    'investigation',
    'nursing',
    'laboratory',
    'imaging',
    'respiratory',
    'diet',
    'clinical',
  ]),
  priority: z.enum(['routine', 'urgent', 'stat']).default('routine'),
  payload: z.record(z.string(), z.unknown()),
  due_at: z.string().datetime({ offset: true }).optional(),
});

export const RoundBody = z.object({
  admission_id: z.string().uuid(),
  subjective: z.string().max(10000).default(''),
  objective: z.string().max(10000).default(''),
  assessment: z.string().trim().min(1).max(10000),
  plan: z.string().trim().min(1).max(10000),
  orders: z.array(RoundOrder).max(50).default([]),
});

export const WorklistSchema = z.object({
  admission_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  patient_name: z.string(),
  ward: z.string().nullable(),
  bed: z.string().nullable(),
  severity: z.enum(['stable', 'watcher', 'unstable']),
  news2_score: z.number().nullable(),
  last_round_at: z.string().nullable(),
  seen_today: z.boolean(),
});

export type RoundBodyInput = z.infer<typeof RoundBody>;
