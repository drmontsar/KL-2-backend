import { z } from 'zod';

export const ErrorSchema = z.object({ error: z.string() });

export const IdParam = z.object({ id: z.string().uuid() });

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.enum(['doctor', 'nurse', 'admin']),
  registration_number: z.string().nullable(),
  specialization: z.string().nullable(),
  phone: z.string().nullable(),
  created_at: z.string(),
  disabled_at: z.string().nullable(),
});

const AllergyEntrySchema = z.object({
  allergen: z.string(),
  reaction: z.string().optional(),
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
});

export const PatientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  dob: z.string(),
  sex: z.enum(['male', 'female', 'other', 'unknown']).nullable(),
  blood_group: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  abha_id: z.string().nullable(),
  allergies: z.array(AllergyEntrySchema),
  revision: z.number(),
  created_at: z.string(),
  created_by: z.string().nullable(),
});

export const AdmissionSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  status: z.enum(['active', 'discharged']),
  severity: z.enum(['unstable', 'watcher', 'stable']),
  ward: z.string().nullable(),
  bed: z.string().nullable(),
  admitted_at: z.string(),
  discharged_at: z.string().nullable(),
  assigned_to: z.string().uuid().nullable(),
  assigned_doctor_id: z.string().uuid().nullable(),
  exit_type: z.enum(['discharged', 'transfer_team', 'transfer_out', 'lama', 'died']).nullable(),
  exit_dest: z.string().nullable(),
  exit_note: z.string().nullable(),
  revision: z.number(),
  created_by: z.string().nullable(),
});

export const ContingencySchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  body: z.string(),
  created_by: z.string().uuid(),
  created_at: z.string(),
});

export const ShiftEventSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  body: z.string(),
  logged_by: z.string().uuid(),
  logged_at: z.string(),
});

export const ActiveAdmissionSchema = AdmissionSchema.extend({
  patient_name: z.string(),
  patient_dob: z.string(),
});

export const DiagnosisSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  admission_id: z.string().uuid().nullable(),
  description: z.string(),
  status: z.enum(['active', 'resolved']),
  diagnosed_at: z.string(),
  resolved_at: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
});

export const NoteSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  kind: z.string(),
  draft_body: z.string().nullable(),
  revision: z.number(),
  created_by: z.string(),
  created_at: z.string(),
});

export const NoteVersionSchema = z.object({
  id: z.string().uuid(),
  note_id: z.string().uuid(),
  version_no: z.number(),
  body: z.string(),
  confirmed_by: z.string(),
  confirmed_at: z.string(),
});

export const AmendmentSchema = z.object({
  id: z.string().uuid(),
  note_version_id: z.string().uuid(),
  body: z.string(),
  reason: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
});

export const OrderSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  kind: z.enum(['medication', 'investigation', 'nursing']),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(['draft', 'confirmed', 'cancelled']),
  revision: z.number(),
  created_by: z.string(),
  created_at: z.string(),
  confirmed_by: z.string().nullable(),
  confirmed_at: z.string().nullable(),
});

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  read_at: z.string().nullable(),
  created_at: z.string(),
});

export const VitalsSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  recorded_by: z.string().uuid(),
  recorded_at: z.string(),
  bp_systolic: z.number().int().nullable(),
  bp_diastolic: z.number().int().nullable(),
  heart_rate: z.number().int().nullable(),
  spo2: z.number().nullable(),
  resp_rate: z.number().int().nullable(),
  temperature: z.number().nullable(),
  glucose: z.number().int().nullable(),
});

export const HandoffSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  requested_by: z.string().uuid(),
  assigned_to: z.string().uuid(),
  reason: z.string().nullable(),
  readback: z.string().nullable(),
  status: z.enum(['pending', 'acknowledged', 'done']),
  requested_at: z.string(),
  acknowledged_at: z.string().nullable(),
  acknowledged_by: z.string().uuid().nullable(),
  done_at: z.string().nullable(),
});

export const TaskSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  admission_id: z.string().uuid(),
  due_at: z.string().nullable(),
  status: z.enum(['pending', 'done', 'cancelled']),
  completed_by: z.string().nullable(),
  completed_at: z.string().nullable(),
  revision: z.number(),
  created_at: z.string(),
  order_kind: z.enum(['medication', 'investigation', 'nursing']),
  order_payload: z.record(z.string(), z.unknown()),
});
