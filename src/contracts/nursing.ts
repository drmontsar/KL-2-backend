import { z } from 'zod';

export const Morse = z.object({
  history: z.union([z.literal(0), z.literal(25)]),
  secondary: z.union([z.literal(0), z.literal(15)]),
  aid: z.union([z.literal(0), z.literal(15), z.literal(30)]),
  iv: z.union([z.literal(0), z.literal(20)]),
  gait: z.union([z.literal(0), z.literal(10), z.literal(20)]),
  mental: z.union([z.literal(0), z.literal(15)]),
});

export const Braden = z.object({
  sensory: z.number().int().min(1).max(4),
  moisture: z.number().int().min(1).max(4),
  activity: z.number().int().min(1).max(4),
  mobility: z.number().int().min(1).max(4),
  nutrition: z.number().int().min(1).max(4),
  friction: z.number().int().min(1).max(3),
});

export const Must = z.object({
  bmi: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  weight_loss: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  acute: z.union([z.literal(0), z.literal(2)]),
});

export const Device = z.object({
  type: z.string().trim().min(1).max(200),
  site: z.string().trim().min(1).max(200),
  inserted_at: z.string().date(),
});

export const AssessmentBody = z.object({
  arrival_source: z.string().trim().min(1).max(200),
  transport_mode: z.string().trim().min(1).max(200),
  identity_verified: z.literal(true),
  allergy_verified: z.literal(true),
  language: z.string().max(300).default(''),
  belongings: z.string().max(3000).default(''),
  dependence: z.string().trim().min(1).max(200),
  skin: z.string().trim().min(1).max(3000),
  vulnerabilities: z.array(z.string().max(200)).max(50).default([]),
  devices: z.array(Device).max(50).default([]),
  pain_score: z.number().int().min(0).max(10),
  pain_site: z.string().max(300).default(''),
  morse: Morse,
  braden: Braden,
  must: Must,
});

export const AssessmentSchema = AssessmentBody.extend({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  assessed_by: z.string().uuid(),
  assessed_at: z.string(),
  morse_score: z.number().int(),
  braden_score: z.number().int(),
  must_score: z.number().int(),
  care_plan: z.array(z.string()),
  reassess_by: z.string(),
});

export const TaskSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  source_assessment_id: z.string().uuid().nullable(),
  description: z.string(),
  interval_minutes: z.number().int(),
  due_at: z.string(),
  last_completed_at: z.string().nullable(),
  status: z.enum(['active', 'cancelled']),
  created_by: z.string().uuid(),
  created_at: z.string(),
});

export const CompleteTaskBody = z.object({
  expected_due_at: z.string().datetime({ offset: true }),
});

export const TaskBody = z.object({
  description: z.string().trim().min(1).max(500),
  interval_minutes: z.number().int().min(5).max(10080),
  due_at: z.string().datetime({ offset: true }),
});

export const FluidBody = z
  .object({
    direction: z.enum(['intake', 'output']),
    category: z.string().trim().min(1).max(200),
    volume_ml: z.number().min(0).max(10000),
    occurred_at: z.string().datetime({ offset: true }),
  })
  .refine(
    (body) => body.direction === 'output' || body.volume_ml > 0,
    'intake must be greater than zero',
  );

export const FluidSchema = FluidBody.safeExtend({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  recorded_by: z.string().uuid(),
  recorded_at: z.string(),
});

export const WeightBody = z.object({
  weight_kg: z.number().positive().max(500),
  measured_at: z.string().datetime({ offset: true }),
});

export const WeightSchema = WeightBody.extend({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  recorded_by: z.string().uuid(),
  recorded_at: z.string(),
});

export const UrineAlertSchema = z.object({
  status: z.enum(['low', 'normal', 'insufficient_data']),
  weight_kg: z.number().nullable(),
  previous_hour_ml: z.number().nullable(),
  preceding_hour_ml: z.number().nullable(),
});

export const FluidQuery = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine((q) => new Date(q.from) < new Date(q.to), 'from must be earlier than to');

export const CallBody = z.object({
  doctor_id: z.string().uuid(),
  situation: z.string().trim().min(1).max(5000),
  background: z.string().trim().min(1).max(5000),
  assessment: z.string().trim().min(1).max(5000),
  request: z.enum(['immediate', 'within_30_minutes', 'telephone_advice']),
});

export const CallSchema = CallBody.extend({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  called_by: z.string().uuid(),
  status: z.enum(['open', 'acknowledged', 'closed']),
  created_at: z.string(),
  acknowledged_at: z.string().nullable(),
  reply: z.string().nullable(),
  closed_by: z.string().uuid().nullable(),
  closed_at: z.string().nullable(),
});

export const ReplyBody = z.object({ reply: z.string().trim().min(1).max(5000) });

export type Assessment = z.infer<typeof AssessmentSchema>;

export type NursingTask = z.infer<typeof TaskSchema>;

export type Fluid = z.infer<typeof FluidSchema>;

export type Weight = z.infer<typeof WeightSchema>;

export type Call = z.infer<typeof CallSchema>;

export type AssessmentBodyInput = z.infer<typeof AssessmentBody>;

export type TaskBodyInput = z.infer<typeof TaskBody>;

export type WeightBodyInput = z.infer<typeof WeightBody>;

export type FluidBodyInput = z.infer<typeof FluidBody>;

export type CallBodyInput = z.infer<typeof CallBody>;
