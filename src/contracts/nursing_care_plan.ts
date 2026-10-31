import { z } from 'zod';

export const ItemSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  problem: z.string(),
  intervention: z.string(),
  status: z.enum(['active', 'resolved']),
  revision: z.number().int(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_by: z.string().uuid().nullable(),
  updated_at: z.string().nullable(),
  resolution_reason: z.string().nullable(),
});

export const CreateBody = z.object({
  problem: z.string().trim().min(1).max(2000),
  intervention: z.string().trim().min(1).max(5000),
});

export const UpdateBody = z
  .object({
    expected_revision: z.number().int().positive(),
    intervention: z.string().trim().min(1).max(5000).optional(),
    status: z.enum(['active', 'resolved']).optional(),
    resolution_reason: z.string().trim().min(1).max(5000).optional(),
  })
  .refine(
    (body) => body.status !== 'resolved' || body.resolution_reason !== undefined,
    'resolution reason required',
  )
  .refine(
    (body) => body.intervention !== undefined || body.status === 'resolved',
    'no change specified',
  );

export type Item = z.infer<typeof ItemSchema>;

export type CreateBodyInput = z.infer<typeof CreateBody>;

export type UpdateBodyInput = z.infer<typeof UpdateBody>;
