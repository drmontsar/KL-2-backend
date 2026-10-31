-- up

CREATE SEQUENCE clinical.uhid_seq START WITH 100001;
ALTER TABLE clinical.patients
  ADD COLUMN uhid text UNIQUE DEFAULT ('UH-' || lpad(nextval('clinical.uhid_seq')::text, 8, '0'));
ALTER TABLE clinical.patients ALTER COLUMN uhid SET NOT NULL;

CREATE TABLE clinical.patient_identifiers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid        NOT NULL REFERENCES clinical.patients(id) ON DELETE CASCADE,
  type       text        NOT NULL CHECK (type IN ('uhid','abha','mrn','external')),
  value      text        NOT NULL,
  issuer     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, value)
);

INSERT INTO clinical.patient_identifiers (patient_id, type, value, issuer)
SELECT id, 'uhid', uhid, 'KliniK' FROM clinical.patients;
INSERT INTO clinical.patient_identifiers (patient_id, type, value, issuer)
SELECT id, 'abha', abha_id, 'ABHA' FROM clinical.patients WHERE abha_id IS NOT NULL
ON CONFLICT (type, value) DO NOTHING;

CREATE TABLE clinical.patient_contacts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid        NOT NULL REFERENCES clinical.patients(id) ON DELETE CASCADE,
  type       text        NOT NULL CHECK (type IN ('phone','email','address')),
  label      text,
  value      text        NOT NULL,
  is_primary boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_primary_contact_per_type
  ON clinical.patient_contacts (patient_id, type) WHERE is_primary;
CREATE INDEX patient_contacts_value ON clinical.patient_contacts (type, value);

INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
SELECT id, 'phone', 'Primary', phone, true FROM clinical.patients WHERE phone IS NOT NULL;
INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
SELECT id, 'address', 'Home', address, true FROM clinical.patients WHERE address IS NOT NULL;

CREATE TABLE clinical.next_of_kin (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid        NOT NULL REFERENCES clinical.patients(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  relationship text        NOT NULL,
  phone        text        NOT NULL,
  address      text,
  is_primary   boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_primary_next_of_kin
  ON clinical.next_of_kin (patient_id) WHERE is_primary;

CREATE TABLE clinical.patient_coverage (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid        NOT NULL REFERENCES clinical.patients(id) ON DELETE CASCADE,
  payer_name     text        NOT NULL,
  policy_number  text        NOT NULL,
  member_id      text,
  valid_from     date,
  valid_until    date,
  is_primary     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  UNIQUE (payer_name, policy_number)
);
CREATE UNIQUE INDEX one_primary_coverage
  ON clinical.patient_coverage (patient_id) WHERE is_primary;

CREATE TABLE clinical.bed_assignments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid        NOT NULL REFERENCES clinical.admissions(id),
  bed_id       uuid        NOT NULL REFERENCES organization.beds(id),
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz,
  assigned_by  uuid        REFERENCES staff.users(id),
  end_reason   text,
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE UNIQUE INDEX one_current_bed_per_admission
  ON clinical.bed_assignments (admission_id) WHERE ends_at IS NULL;
CREATE UNIQUE INDEX one_current_admission_per_bed
  ON clinical.bed_assignments (bed_id) WHERE ends_at IS NULL;
CREATE INDEX bed_assignment_history
  ON clinical.bed_assignments (admission_id, starts_at DESC);

INSERT INTO clinical.bed_assignments
  (admission_id, bed_id, starts_at, ends_at, assigned_by, end_reason)
SELECT id, bed_id, admitted_at,
       CASE WHEN status = 'discharged' THEN discharged_at END,
       created_by,
       CASE WHEN status = 'discharged' THEN 'discharge' END
FROM clinical.admissions
WHERE bed_id IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX patients_name_trgm ON clinical.patients USING gin (name gin_trgm_ops);

-- down

DROP INDEX IF EXISTS clinical.patients_name_trgm;
DROP TABLE IF EXISTS clinical.bed_assignments;
DROP TABLE IF EXISTS clinical.patient_coverage;
DROP TABLE IF EXISTS clinical.next_of_kin;
DROP TABLE IF EXISTS clinical.patient_contacts;
DROP TABLE IF EXISTS clinical.patient_identifiers;
ALTER TABLE clinical.patients DROP COLUMN IF EXISTS uhid;
DROP SEQUENCE IF EXISTS clinical.uhid_seq;
