-- up
CREATE SCHEMA IF NOT EXISTS forms;
CREATE TABLE forms.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  created_by uuid REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE forms.template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES forms.templates(id),
  version integer NOT NULL CHECK (version > 0),
  fields jsonb NOT NULL,
  synthetic boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);
WITH seeded AS (
  INSERT INTO forms.templates (name, category)
  VALUES
    ('[DEMO] General consent for admission and treatment', 'Consent'),
    ('[DEMO] Informed consent for surgery or procedure', 'Consent'),
    ('[DEMO] Anaesthesia consent', 'Consent'),
    ('[DEMO] Blood transfusion consent', 'Consent'),
    ('[DEMO] High-risk consent', 'Consent'),
    ('[DEMO] Cashless pre-authorisation request', 'Insurance'),
    ('[DEMO] Enhancement request', 'Insurance'),
    ('[DEMO] Pre-operative checklist', 'Clinical'),
    ('[DEMO] Referral and transfer note', 'Clinical'),
    ('[DEMO] LAMA / DAMA form', 'Discharge and legal'),
    ('[DEMO] Medical certificate', 'Discharge and legal'),
    ('[DEMO] Medico-legal case intimation', 'Discharge and legal')
  RETURNING id
)
INSERT INTO forms.template_versions (template_id, version, fields, synthetic)
SELECT id, 1, '[{"key":"patient_name","label":"Patient name","type":"text","source":"name","required":true},{"key":"uhid","label":"UHID","type":"text","source":"uhid","required":true},{"key":"details","label":"Details (demo only)","type":"long_text","required":true},{"key":"doctor_signature","label":"Doctor signature (demo only)","type":"signature","signer_role":"doctor","required":true}]'::jsonb, true
FROM seeded;

CREATE TABLE forms.instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES clinical.patients(id),
  admission_id uuid REFERENCES clinical.admissions(id),
  template_id uuid NOT NULL REFERENCES forms.templates(id),
  created_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forms_instances_patient ON forms.instances (patient_id, created_at DESC);
CREATE TABLE forms.instance_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES forms.instances(id),
  template_version_id uuid NOT NULL REFERENCES forms.template_versions(id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  fields jsonb NOT NULL,
  form_values jsonb NOT NULL DEFAULT '{}',
  source_snapshot jsonb NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_by uuid REFERENCES staff.users(id),
  finalized_at timestamptz,
  CHECK ((status = 'draft' AND finalized_by IS NULL AND finalized_at IS NULL) OR (status = 'final' AND finalized_by IS NOT NULL AND finalized_at IS NOT NULL)),
  UNIQUE (instance_id, version)
);
CREATE TABLE forms.signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES forms.instance_versions(id),
  field_key text NOT NULL,
  role text NOT NULL CHECK (role IN ('doctor','consultant','patient','witness')),
  signer_name text NOT NULL,
  captured_by uuid NOT NULL REFERENCES staff.users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, field_key)
);

-- down
DROP TABLE IF EXISTS forms.signatures;
DROP TABLE IF EXISTS forms.instance_versions;
DROP TABLE IF EXISTS forms.instances;
DROP TABLE IF EXISTS forms.template_versions;
DROP TABLE IF EXISTS forms.templates;
DROP SCHEMA IF EXISTS forms;
