import { z } from 'zod';

export const ScheduleSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  order_id: z.string().uuid(),
  drug: z.string(),
  dose: z.string(),
  route: z.string(),
  prn_indication: z.string().nullable(),
  prn_min_interval_minutes: z.number().int().nullable(),
  prn_max_doses_24h: z.number().int().nullable(),
  catalog_id: z.string().uuid().nullable(),
  active: z.boolean(),
  created_by: z.string().uuid(),
  created_at: z.string(),
});

export const ScheduleBody = z
  .object({
    drug: z.string().trim().min(1).max(300),
    dose: z.string().trim().min(1).max(200),
    route: z.string().trim().min(1).max(100),
    catalog_id: z.string().uuid().optional(),
    prn_indication: z.string().trim().min(1).max(500).optional(),
    prn_min_interval_minutes: z.number().int().min(1).max(10080).optional(),
    prn_max_doses_24h: z.number().int().min(1).max(100).optional(),
  })
  .refine(
    (body) =>
      body.prn_indication
        ? body.prn_min_interval_minutes !== undefined && body.prn_max_doses_24h !== undefined
        : body.prn_min_interval_minutes === undefined && body.prn_max_doses_24h === undefined,
    'PRN indication and both limits must be specified together',
  );

export const DoseSchema = z.object({
  id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  due_at: z.string(),
  status: z.enum(['scheduled', 'given', 'held', 'missed']),
  acted_by: z.string().uuid().nullable(),
  acted_at: z.string().nullable(),
  hold_reason: z.string().nullable(),
  administration_reason: z.string().nullable(),
});

export const ReviewSchema = z.object({
  id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  patient_revision: z.union([z.number(), z.string()]),
  decision: z.enum(['safe', 'contraindicated']),
  reason: z.string(),
  reviewed_by: z.string().uuid(),
  reviewed_at: z.string(),
});

export const ReviewBody = z.object({
  decision: z.enum(['safe', 'contraindicated']),
  reason: z.string().trim().min(3).max(5000),
});

export const DoseBody = z.object({ due_at: z.string().datetime({ offset: true }) });

export const GiveBody = z.object({
  scanned_uhid: z.string().trim().min(1),
  drug: z.string().trim().min(1),
  dose: z.string().trim().min(1),
  route: z.string().trim().min(1),
  allergy_checked: z.literal(true),
  time_checked: z.literal(true),
  administration_reason: z.string().trim().min(1).max(5000).optional(),
});

export const HoldBody = z.object({ reason: z.string().trim().min(3).max(5000) });

export const InfusionAction = z.enum(['start', 'rate_change', 'stop']);

export const InfusionBody = z
  .object({
    action: InfusionAction,
    rate: z.string().trim().min(1).max(200).optional(),
    reason: z.string().trim().min(3).max(5000),
    scanned_uhid: z.string().trim().min(1),
    drug: z.string().trim().min(1),
    dose: z.string().trim().min(1),
    route: z.string().trim().min(1),
    allergy_checked: z.literal(true),
  })
  .refine(
    (body) => (body.action === 'stop' ? body.rate === undefined : body.rate !== undefined),
    'rate is required for start/rate change and omitted for stop',
  );

export const InfusionSchema = z.object({
  id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  action: InfusionAction,
  rate: z.string().nullable(),
  reason: z.string(),
  recorded_by: z.string().uuid(),
  recorded_at: z.string(),
});

export type Schedule = z.infer<typeof ScheduleSchema>;

export type Dose = z.infer<typeof DoseSchema>;

export type Review = z.infer<typeof ReviewSchema>;

export type Infusion = z.infer<typeof InfusionSchema>;

export const CatalogItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  brand: z.string(),
  ingredient: z.string(),
  drug_class: z.string(),
  in_stock: z.boolean(),
  synthetic: z.literal(true),
});

export type ScheduleBodyInput = z.infer<typeof ScheduleBody>;

export type ReviewBodyInput = z.infer<typeof ReviewBody>;

export type GiveBodyInput = z.infer<typeof GiveBody>;

export type InfusionBodyInput = z.infer<typeof InfusionBody>;
