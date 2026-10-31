import { z } from 'zod';

export const Field = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    label: z.string().trim().min(1).max(200),
    type: z.enum(['text', 'long_text', 'number', 'choice', 'yes_no', 'signature']),
    required: z.boolean().default(false),
    source: z.enum(['name', 'uhid', 'phone', 'address', 'blood_group', 'abha_id']).optional(),
    options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    signer_role: z.enum(['doctor', 'consultant', 'patient', 'witness']).optional(),
  })
  .refine((field) => field.type !== 'choice' || !!field.options?.length, 'choice requires options')
  .refine((field) => field.type !== 'signature' || !!field.signer_role, 'signature role required');

export const Fields = z
  .array(Field)
  .min(1)
  .max(100)
  .refine(
    (fields) => new Set(fields.map((field) => field.key)).size === fields.length,
    'field keys must be unique',
  );

export const TemplateBody = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  fields: Fields,
});

export const TemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: z.string(),
  template_version_id: z.string().uuid(),
  version: z.number().int(),
  fields: z.array(Field),
  synthetic: z.boolean(),
});

export const InstanceBody = z.object({
  patient_id: z.string().uuid(),
  admission_id: z.string().uuid().optional(),
  template_id: z.string().uuid(),
});

export const VersionSchema = z.object({
  id: z.string().uuid(),
  instance_id: z.string().uuid(),
  template_version_id: z.string().uuid(),
  version: z.number().int(),
  status: z.enum(['draft', 'final']),
  fields: z.array(Field),
  form_values: z.record(z.string(), z.unknown()),
  source_snapshot: z.record(z.string(), z.unknown()),
  revision: z.number().int(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  finalized_by: z.string().uuid().nullable(),
  finalized_at: z.string().nullable(),
});

export const SaveBody = z.object({
  expected_revision: z.number().int().positive(),
  form_values: z.record(z.string(), z.unknown()),
});

export const SignBody = z.object({
  field_key: z.string(),
  signer_name: z.string().trim().min(1).max(200),
});

export const SignatureSchema = z.object({
  id: z.string().uuid(),
  version_id: z.string().uuid(),
  field_key: z.string(),
  role: z.enum(['doctor', 'consultant', 'patient', 'witness']),
  signer_name: z.string(),
  captured_by: z.string().uuid(),
  signed_at: z.string(),
});

export const DetailSchema = z.object({
  version: VersionSchema,
  signatures: z.array(SignatureSchema),
});

export const InstanceSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  admission_id: z.string().uuid().nullable(),
  template_id: z.string().uuid(),
  created_by: z.string().uuid(),
  created_at: z.string(),
});

export type FieldValue = z.infer<typeof Field>;

export type Version = z.infer<typeof VersionSchema>;

export type Signature = z.infer<typeof SignatureSchema>;

export type TemplateBodyInput = z.infer<typeof TemplateBody>;

export type InstanceBodyInput = z.infer<typeof InstanceBody>;

export type SaveBodyInput = z.infer<typeof SaveBody>;

export type SignBodyInput = z.infer<typeof SignBody>;
