-- up
CREATE SCHEMA IF NOT EXISTS opd;
CREATE SEQUENCE opd.token_sequence;
CREATE TABLE opd.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES clinical.patients(id),
  token text NOT NULL UNIQUE DEFAULT ('OPD-' || lpad(nextval('opd.token_sequence')::text, 6, '0')),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','seen')),
  chief_complaints jsonb NOT NULL,
  patient_notes text NOT NULL DEFAULT '',
  reported_medications text NOT NULL DEFAULT '',
  chronic_conditions text NOT NULL DEFAULT '',
  triage jsonb,
  consultation_note text NOT NULL DEFAULT '',
  follow_up text NOT NULL DEFAULT '1 week',
  created_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  signed_by uuid REFERENCES staff.users(id),
  signed_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  CHECK ((status = 'waiting' AND signed_at IS NULL AND signed_by IS NULL) OR (status = 'seen' AND signed_at IS NOT NULL AND signed_by IS NOT NULL))
);
CREATE INDEX opd_queue ON opd.visits (status, created_at);
CREATE TABLE opd.diagnosis_catalog (
  code text PRIMARY KEY,
  description text NOT NULL,
  synthetic boolean NOT NULL DEFAULT true CHECK (synthetic)
);
INSERT INTO opd.diagnosis_catalog (code, description) VALUES
 ('DEMO-DX-001','Demo respiratory complaint'), ('DEMO-DX-002','Demo fever'), ('DEMO-DX-003','Demo abdominal pain');
CREATE TABLE opd.visit_diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES opd.visits(id),
  code text NOT NULL REFERENCES opd.diagnosis_catalog(code),
  UNIQUE (visit_id, code)
);
CREATE TABLE opd.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES opd.visits(id),
  medication_id uuid NOT NULL REFERENCES clinical.medication_catalog(id),
  dose text NOT NULL,
  route text NOT NULL,
  frequency text NOT NULL,
  duration text NOT NULL,
  allergy_override_reason text,
  created_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE opd.investigation_catalog (
  code text PRIMARY KEY,
  name text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'INR',
  synthetic boolean NOT NULL DEFAULT true CHECK (synthetic)
);
INSERT INTO opd.investigation_catalog (code, name, price) VALUES
 ('DEMO-LAB-001','Demo blood count',300), ('DEMO-LAB-002','Demo imaging',500);
CREATE TABLE opd.visit_investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES opd.visits(id),
  code text NOT NULL REFERENCES opd.investigation_catalog(code),
  UNIQUE (visit_id, code)
);
CREATE TABLE opd.visit_charges (
  visit_id uuid PRIMARY KEY REFERENCES opd.visits(id),
  consultation_amount numeric(12,2) NOT NULL,
  investigation_amount numeric(12,2) NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  calculated_at timestamptz NOT NULL DEFAULT now()
);

-- down
DROP TABLE IF EXISTS opd.visit_charges;
DROP TABLE IF EXISTS opd.visit_investigations;
DROP TABLE IF EXISTS opd.investigation_catalog;
DROP TABLE IF EXISTS opd.prescriptions;
DROP TABLE IF EXISTS opd.visit_diagnoses;
DROP TABLE IF EXISTS opd.diagnosis_catalog;
DROP TABLE IF EXISTS opd.visits;
DROP SEQUENCE IF EXISTS opd.token_sequence;
DROP SCHEMA IF EXISTS opd;
