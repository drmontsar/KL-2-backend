-- up
CREATE UNIQUE INDEX one_active_admission_per_patient ON clinical.admissions (patient_id) WHERE status = 'active';
CREATE TABLE clinical.admission_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES clinical.patients(id),
  source text NOT NULL CHECK (source IN ('emergency','opd','elective','external')),
  diagnosis text NOT NULL,
  clinical_handover text NOT NULL DEFAULT '',
  requested_unit_id uuid NOT NULL REFERENCES organization.units(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  requested_by uuid NOT NULL REFERENCES staff.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES staff.users(id),
  resolved_at timestamptz,
  decline_reason text,
  admission_id uuid REFERENCES clinical.admissions(id)
);
CREATE UNIQUE INDEX one_pending_admission_request_per_patient ON clinical.admission_requests (patient_id) WHERE status = 'pending';
CREATE TABLE clinical.admission_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  completed_by uuid REFERENCES staff.users(id),
  completed_at timestamptz,
  evidence text,
  UNIQUE (admission_id, code),
  CHECK ((status = 'pending' AND completed_by IS NULL AND completed_at IS NULL) OR (status = 'completed' AND completed_by IS NOT NULL AND completed_at IS NOT NULL))
);

-- down
DROP TABLE IF EXISTS clinical.admission_checklist_items;
DROP TABLE IF EXISTS clinical.admission_requests;
DROP INDEX IF EXISTS clinical.one_active_admission_per_patient;
