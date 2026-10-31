import { z } from 'zod';
import { PatientSchema } from './common';

export const VisitSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  token: z.string(),
  status: z.enum(['waiting', 'seen']),
  chief_complaints: z.array(z.string()),
  patient_notes: z.string(),
  reported_medications: z.string(),
  chronic_conditions: z.string(),
  triage: z.record(z.string(), z.unknown()).nullable(),
  consultation_note: z.string(),
  follow_up: z.string(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  signed_by: z.string().uuid().nullable(),
  signed_at: z.string().nullable(),
  revision: z.number().int(),
});

export const OPDPatientSchema = PatientSchema.pick({
  id: true,
  name: true,
  uhid: true,
  dob: true,
  sex: true,
  allergies: true,
  phone: true,
}).extend({ payer_name: z.string().nullable() });

export const QueueVisitSchema = VisitSchema.extend({ patient: OPDPatientSchema });

export const CheckinBody = z
  .object({
    patient_id: z.string().uuid().optional(),
    patient: z
      .object({
        name: z.string().trim().min(1).max(200),
        dob: z
          .string()
          .date()
          .refine(
            (date) => date <= new Date().toISOString().slice(0, 10),
            'date of birth cannot be in the future',
          ),
        sex: z.enum(['male', 'female', 'other', 'unknown']).optional(),
        phone: z.string().trim().max(50).optional(),
        allergies: z
          .array(
            z.object({
              allergen: z.string().trim().min(1).max(200),
              reaction: z.string().optional(),
              severity: z.enum(['mild', 'moderate', 'severe']).optional(),
            }),
          )
          .max(100)
          .default([]),
      })
      .optional(),
    chief_complaints: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    patient_notes: z.string().max(5000).default(''),
    reported_medications: z.string().max(5000).default(''),
    chronic_conditions: z.string().max(5000).default(''),
  })
  .refine(
    (body) => Boolean(body.patient_id) !== Boolean(body.patient),
    'provide either patient_id or patient details',
  );

export const DraftBody = z.object({
  expected_revision: z.number().int().positive(),
  consultation_note: z.string().max(30000),
  follow_up: z.enum(['3 days', '1 week', '2 weeks', 'if needed', 'admit']),
});

export const TriageBody = z.object({
  expected_revision: z.number().int().positive(),
  systolic: z.number().int().min(40).max(300),
  diastolic: z.number().int().min(20).max(200),
  pulse: z.number().int().min(20).max(250),
  temperature: z.number().min(25).max(45),
  spo2: z.number().min(50).max(100),
  weight_kg: z.number().positive().max(500),
});

export const DiagnosisSchema = z.object({
  code: z.string(),
  description: z.string(),
  synthetic: z.boolean(),
});

export const InvestigationSchema = z.object({
  code: z.string(),
  name: z.string(),
  price: z.string(),
  currency: z.string(),
  synthetic: z.boolean(),
});

export const SelectCode = z.object({ code: z.string().trim().min(1) });

export const PrescriptionBody = z.object({
  medication_id: z.string().uuid(),
  dose: z.string().trim().min(1).max(200),
  route: z.string().trim().min(1).max(100),
  frequency: z.string().trim().min(1).max(200),
  duration: z.string().trim().min(1).max(200),
  allergy_override_reason: z.string().trim().min(3).max(5000).optional(),
});

export const PrescriptionSchema = z.object({
  id: z.string().uuid(),
  visit_id: z.string().uuid(),
  medication_id: z.string().uuid(),
  dose: z.string(),
  route: z.string(),
  frequency: z.string(),
  duration: z.string(),
  allergy_override_reason: z.string().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
});

export const ChargeSchema = z.object({
  visit_id: z.string().uuid(),
  consultation_amount: z.string(),
  investigation_amount: z.string(),
  total_amount: z.string(),
  currency: z.string(),
  calculated_at: z.string(),
});

export const SearchQuery = z.object({ q: z.string().max(200).default('') });

export const AdmissionHandoffBody = z.object({
  requested_unit_id: z.string().uuid(),
  diagnosis: z.string().trim().min(1).max(5000),
});

export const DispatchSchema = z.object({
  id: z.string().uuid(),
  visit_id: z.string().uuid(),
  kind: z.enum(['pharmacy', 'collection']),
  status: z.enum(['pending', 'completed']),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  completed_by: z.string().uuid().nullable(),
});

export const DispatchDetailSchema = DispatchSchema.extend({
  patient_name: z.string(),
  patient_uhid: z.string(),
  items: z.array(z.record(z.string(), z.unknown())),
  synthetic: z.literal(true),
});

export const DispatchQuery = z.object({
  kind: z.enum(['pharmacy', 'collection']).optional(),
  status: z.enum(['pending', 'completed']).optional(),
});

export const AdmissionHandoffSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  source: z.literal('opd'),
  diagnosis: z.string(),
  clinical_handover: z.string(),
  requested_unit_id: z.string().uuid(),
  status: z.enum(['pending', 'accepted', 'declined']),
  requested_by: z.string().uuid(),
  requested_at: z.string(),
  resolved_by: z.string().uuid().nullable(),
  resolved_at: z.string().nullable(),
  decline_reason: z.string().nullable(),
  admission_id: z.string().uuid().nullable(),
  opd_visit_id: z.string().uuid(),
});

export const SelectionSchema = z.object({
  id: z.string().uuid(),
  visit_id: z.string().uuid(),
  code: z.string(),
});

export type Visit = z.infer<typeof VisitSchema>;

export type Prescription = z.infer<typeof PrescriptionSchema>;

export type Charge = z.infer<typeof ChargeSchema>;

export type CheckinBodyInput = z.infer<typeof CheckinBody>;

export type PrescriptionBodyInput = z.infer<typeof PrescriptionBody>;

export type AdmissionHandoffBodyInput = z.infer<typeof AdmissionHandoffBody>;
