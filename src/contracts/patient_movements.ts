import { z } from 'zod';

export const Equipment = z.enum([
  'portable_monitor',
  'oxygen_cylinder',
  'transport_ventilator',
  'infusion_pumps',
]);

export const MovementSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  movement_type: z.enum(['permanent', 'temporary']),
  destination_unit_id: z.string().uuid().nullable(),
  destination_area: z.string().nullable(),
  source_bed_id: z.string().uuid().nullable(),
  destination_bed_id: z.string().uuid().nullable(),
  reason: z.string(),
  escort: z.enum(['porter', 'nurse', 'doctor']),
  equipment: z.array(Equipment),
  status: z.enum(['requested', 'reserved', 'in_transit', 'arrived', 'returned', 'cancelled']),
  requested_by: z.string().uuid(),
  requested_at: z.string(),
  reserved_by: z.string().uuid().nullable(),
  departed_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

export const Base = {
  admission_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(5000),
  escort: z.enum(['porter', 'nurse', 'doctor']),
  equipment: z.array(Equipment).max(4).default([]),
};

export const CreateBody = z.discriminatedUnion('movement_type', [
  z.object({
    ...Base,
    movement_type: z.literal('permanent'),
    destination_unit_id: z.string().uuid(),
  }),
  z.object({
    ...Base,
    movement_type: z.literal('temporary'),
    destination_area: z.enum([
      'CT',
      'MRI',
      'cath_lab',
      'operation_theatre',
      'dialysis',
      'endoscopy',
    ]),
  }),
]);

export const ReserveBody = z.object({ bed_id: z.string().uuid() });

export type Movement = z.infer<typeof MovementSchema>;

export type CreateBodyInput = z.infer<typeof CreateBody>;
