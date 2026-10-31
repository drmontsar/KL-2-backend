import { z } from 'zod';

export const ReferralSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  requested_by: z.string().uuid(),
  consultant_id: z.string().uuid(),
  specialty: z.string(),
  urgency: z.enum(['routine', 'urgent', 'emergency']),
  question: z.string(),
  findings: z.string(),
  status: z.enum(['sent', 'seen', 'opinion', 'acknowledged', 'closed', 'withdrawn']),
  impression: z.string().nullable(),
  recommendations: z.string().nullable(),
  call_again: z.string().nullable(),
  created_at: z.string(),
  seen_at: z.string().nullable(),
  opinion_at: z.string().nullable(),
  opinion_note_id: z.string().uuid().nullable(),
  acknowledged_by: z.string().uuid().nullable(),
  acknowledged_at: z.string().nullable(),
  closed_at: z.string().nullable(),
});

export const CreateBody = z.object({
  admission_id: z.string().uuid(),
  consultant_id: z.string().uuid(),
  specialty: z.string().trim().min(1).max(200),
  urgency: z.enum(['routine', 'urgent', 'emergency']),
  question: z.string().trim().min(1).max(5000),
  findings: z.string().max(10000).default(''),
});

export const OpinionBody = z.object({
  impression: z.string().trim().min(1).max(10000),
  recommendations: z.string().trim().min(1).max(10000),
  call_again: z.string().max(5000).optional(),
});

export const Query = z.object({
  admission_id: z.string().uuid().optional(),
  status: z.enum(['sent', 'seen', 'opinion', 'acknowledged', 'closed', 'withdrawn']).optional(),
});

export const RecommendationOrderBody = z.object({
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
});

export type CreateBodyInput = z.infer<typeof CreateBody>;

export type OpinionBodyInput = z.infer<typeof OpinionBody>;

export type RecommendationOrderBodyInput = z.infer<typeof RecommendationOrderBody>;
