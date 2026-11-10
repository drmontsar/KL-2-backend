import { z } from 'zod';

export const ErrorSchema = z.object({ error: z.string() });

export const IdParam = z.object({ id: z.string().uuid() });

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.enum(['doctor', 'nurse', 'admin']),
  job_role: z.enum([
    'duty_doctor',
    'consultant',
    'staff_nurse',
    'pharmacist',
    'billing_insurance',
    'bed_desk',
    'administrator',
  ]),
  registration_number: z.string().nullable(),
  specialization: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().email().nullable().optional(),
  current_area: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
  disabled_at: z.string().nullable(),
});

export const DoctorPresenceSchema = UserSchema.extend({
  online: z.boolean(),
});

const AllergyEntrySchema = z.object({
  allergen: z.string(),
  reaction: z.string().optional(),
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
});

export const PatientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  uhid: z.string(),
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
  bed_id: z.string().uuid().nullable(),
  unit_id: z.string().uuid().nullable(),
  admitted_at: z.string(),
  arrival_status: z.enum(['incoming', 'admitted']),
  arrived_at: z.string().nullable(),
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
  intake_pending: z.boolean().optional(),
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
  payload: z.record(z.string(), z.unknown()),
  priority: z.enum(['routine', 'urgent', 'stat']),
  status: z.enum(['draft', 'confirmed', 'cancelled', 'completed', 'discontinued']),
  revision: z.number(),
  created_by: z.string(),
  created_at: z.string(),
  confirmed_by: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  acknowledged_by: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  closed_by: z.string().nullable(),
  closed_at: z.string().nullable(),
  close_reason: z.string().nullable(),
  order_set_item_id: z.string().uuid().nullable(),
  cross_referral_id: z.string().uuid().nullable(),
  consultant_round_id: z.string().uuid().nullable(),
  requires_approval: z.boolean(),
  approval_status: z.enum(['not_required', 'pending', 'approved', 'rejected']),
  approval_by: z.string().uuid().nullable(),
  approval_at: z.string().nullable(),
  approval_reason: z.string().nullable(),
});

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  read_at: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  created_at: z.string(),
});

export const VitalsSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  recorded_by: z.string().uuid(),
  recorded_at: z.string(),
  event_order: z.string(),
  bp_systolic: z.number().int().nullable(),
  bp_diastolic: z.number().int().nullable(),
  heart_rate: z.number().int().nullable(),
  spo2: z.number().nullable(),
  resp_rate: z.number().int().nullable(),
  temperature: z.number().nullable(),
  glucose: z.number().int().nullable(),
  on_supplemental_oxygen: z.boolean().nullable(),
  consciousness: z.enum(['alert', 'confusion', 'voice', 'pain', 'unresponsive']).nullable(),
  news2_score: z.number().int().nullable(),
  news2_escalation: z.enum(['low', 'low-medium', 'medium', 'high']).nullable(),
  news2_component_scores: z.record(z.string(), z.number()).nullable(),
  news2_rule_version: z.string().nullable(),
});

export const ClinicalAlertSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  source_vitals_id: z.string().uuid().nullable(),
  type: z.enum(['news2', 'low_urine_output']),
  severity: z.enum(['caution', 'warning']),
  message: z.string(),
  status: z.enum(['active', 'acknowledged', 'resolved', 'superseded']),
  created_at: z.string(),
  acknowledged_by: z.string().uuid().nullable(),
  acknowledged_at: z.string().nullable(),
  resolved_by: z.string().uuid().nullable(),
  resolved_at: z.string().nullable(),
  resolution_reason: z.string().nullable(),
  superseded_by: z.string().uuid().nullable(),
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

const HandoverSnapshotSchema = z.object({
  patient_name: z.string(),
  patient_dob: z.string(),
  ward: z.string().nullable(),
  bed: z.string().nullable(),
  severity: z.enum(['unstable', 'watcher', 'stable']),
  diagnoses: z.array(z.string()),
  contingencies: z.array(z.string()),
  shift_events: z.array(z.object({ body: z.string(), logged_at: z.string() })),
  latest_note: z.string().nullable(),
});

export const HandoverAcknowledgmentSchema = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  item_version: z.number().int(),
  acknowledged_by: z.string().uuid(),
  notes: z.string().nullable(),
  acknowledged_at: z.string(),
});

export const HandoverItemSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  admission_id: z.string().uuid(),
  snapshot: HandoverSnapshotSchema,
  item_version: z.number().int(),
  created_at: z.string(),
  acknowledgment: HandoverAcknowledgmentSchema.nullable(),
  stale: z.boolean(),
});

export const HandoverSessionSchema = z.object({
  id: z.string().uuid(),
  outgoing_doctor_id: z.string().uuid(),
  incoming_doctor_id: z.string().uuid(),
  ward: z.string().nullable(),
  status: z.enum(['active', 'completed']),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

export const HandoverSessionDetailSchema = HandoverSessionSchema.extend({
  items: z.array(HandoverItemSchema),
});

export const TransferRequestSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  from_doctor_id: z.string().uuid(),
  to_doctor_id: z.string().uuid(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  message: z.string().nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  patient_name: z.string(),
  ward: z.string().nullable(),
  bed: z.string().nullable(),
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
  order_kind: z.enum([
    'medication',
    'investigation',
    'nursing',
    'laboratory',
    'imaging',
    'respiratory',
    'diet',
    'clinical',
  ]),
  order_payload: z.record(z.string(), z.unknown()),
});
