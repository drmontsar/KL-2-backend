-- up

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS staff;
CREATE SCHEMA IF NOT EXISTS clinical;

-- Staff: one table, not doctors + nurses
CREATE TABLE IF NOT EXISTS staff.users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  role                text NOT NULL CHECK (role IN ('doctor','nurse','admin')),
  registration_number text UNIQUE,
  specialization      text,
  phone               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  disabled_at         timestamptz
);

-- Patients and encounters
CREATE TABLE IF NOT EXISTS clinical.patients (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  dob         date        NOT NULL,
  sex         text        CHECK (sex IN ('male','female','other','unknown')),
  blood_group text,
  phone       text,
  address     text,
  abha_id     text        UNIQUE,
  revision    bigint      NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES staff.users(id)
);

CREATE TABLE IF NOT EXISTS clinical.encounters (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid        NOT NULL REFERENCES clinical.patients(id),
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','discharged')),
  ward          text,
  bed           text,
  admitted_at   timestamptz NOT NULL DEFAULT now(),
  discharged_at timestamptz,
  revision      bigint      NOT NULL DEFAULT 1,
  created_by    uuid        REFERENCES staff.users(id),
  CONSTRAINT discharged_has_time
    CHECK ((status <> 'discharged') OR discharged_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS encounters_active_ward ON clinical.encounters (ward) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS encounters_patient     ON clinical.encounters (patient_id);

-- Problem list and allergies
CREATE TABLE IF NOT EXISTS clinical.diagnoses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid        NOT NULL REFERENCES clinical.patients(id),
  encounter_id uuid        REFERENCES clinical.encounters(id),
  description  text        NOT NULL,
  status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  diagnosed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  created_by   uuid        NOT NULL REFERENCES staff.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diagnoses_patient ON clinical.diagnoses (patient_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS clinical.patient_allergies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid        NOT NULL REFERENCES clinical.patients(id),
  allergen    text        NOT NULL,
  reaction    text,
  severity    text        CHECK (severity IN ('mild','moderate','severe')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL REFERENCES staff.users(id),
  UNIQUE (patient_id, allergen)
);

-- Notes
CREATE TABLE IF NOT EXISTS clinical.notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid        NOT NULL REFERENCES clinical.encounters(id),
  kind         text        NOT NULL,
  draft_body   text,
  revision     bigint      NOT NULL DEFAULT 1,
  created_by   uuid        NOT NULL REFERENCES staff.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_encounter ON clinical.notes (encounter_id);

CREATE TABLE IF NOT EXISTS clinical.note_versions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      uuid        NOT NULL REFERENCES clinical.notes(id),
  version_no   int         NOT NULL,
  body         text        NOT NULL,
  confirmed_by uuid        NOT NULL REFERENCES staff.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, version_no)
);

CREATE TABLE IF NOT EXISTS clinical.amendments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_version_id uuid        NOT NULL REFERENCES clinical.note_versions(id),
  body            text        NOT NULL,
  reason          text,
  created_by      uuid        NOT NULL REFERENCES staff.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Orders and tasks
CREATE TABLE IF NOT EXISTS clinical.orders (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid        NOT NULL REFERENCES clinical.encounters(id),
  kind         text        NOT NULL CHECK (kind IN ('medication','investigation','nursing')),
  payload      jsonb       NOT NULL,
  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','confirmed','cancelled')),
  revision     bigint      NOT NULL DEFAULT 1,
  created_by   uuid        NOT NULL REFERENCES staff.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid        REFERENCES staff.users(id),
  confirmed_at timestamptz,
  CONSTRAINT confirmed_has_actor
    CHECK ((status <> 'confirmed') OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS orders_encounter ON clinical.orders (encounter_id, status);

CREATE TABLE IF NOT EXISTS clinical.tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid        NOT NULL REFERENCES clinical.orders(id),
  encounter_id uuid        NOT NULL REFERENCES clinical.encounters(id),
  due_at       timestamptz,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','done','cancelled')),
  completed_by uuid        REFERENCES staff.users(id),
  completed_at timestamptz,
  revision     bigint      NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT done_has_actor
    CHECK ((status <> 'done') OR (completed_by IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS tasks_pending ON clinical.tasks (status, due_at) WHERE status = 'pending';

-- Audit log
CREATE TABLE IF NOT EXISTS clinical.audit_log (
  id            bigserial   PRIMARY KEY,
  actor_user_id uuid        REFERENCES staff.users(id),
  action        text        NOT NULL,
  record_table  text        NOT NULL,
  record_id     uuid        NOT NULL,
  before        jsonb,
  after         jsonb,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_record ON clinical.audit_log (record_table, record_id);

-- down

DROP SCHEMA IF EXISTS clinical CASCADE;
DROP SCHEMA IF EXISTS staff CASCADE;
