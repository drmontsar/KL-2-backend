import { z } from 'zod';

export const Kind = z.enum([
  'medication',
  'investigation',
  'nursing',
  'laboratory',
  'imaging',
  'respiratory',
  'diet',
  'clinical',
]);

export const Priority = z.enum(['routine', 'urgent', 'stat']);

export const ItemBody = z.object({
  kind: Kind,
  priority: Priority.default('routine'),
  payload: z.record(z.string(), z.unknown()),
});

export const SetBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional(),
  items: z.array(ItemBody).min(1).max(100),
});

export const ItemSchema = ItemBody.extend({
  id: z.string().uuid(),
  order_set_id: z.string().uuid(),
  position: z.number().int(),
});

export const SetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  items: z.array(ItemSchema),
});

export const ApplyBody = z.object({
  admission_id: z.string().uuid(),
  item_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate item IDs'),
});

export const ApplyHeaders = z.object({ 'idempotency-key': z.string().trim().min(1).max(128) });

export type SetBodyInput = z.infer<typeof SetBody>;

export type ApplyBodyInput = z.infer<typeof ApplyBody>;
