-- up

-- Fold allergies into the patient record
ALTER TABLE clinical.patients
  ADD COLUMN IF NOT EXISTS allergies jsonb NOT NULL DEFAULT '[]';
DROP TABLE IF EXISTS clinical.patient_allergies;

-- Rename encounters → admissions
ALTER TABLE IF EXISTS clinical.encounters RENAME TO admissions;

-- Rename encounter_id → admission_id in all child tables
ALTER TABLE IF EXISTS clinical.diagnoses  RENAME COLUMN encounter_id TO admission_id;
ALTER TABLE IF EXISTS clinical.notes      RENAME COLUMN encounter_id TO admission_id;
ALTER TABLE IF EXISTS clinical.orders     RENAME COLUMN encounter_id TO admission_id;
ALTER TABLE IF EXISTS clinical.tasks      RENAME COLUMN encounter_id TO admission_id;

-- Add nurse assignment
ALTER TABLE clinical.admissions
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES staff.users;

-- down

ALTER TABLE IF EXISTS clinical.admissions DROP COLUMN IF EXISTS assigned_to;

ALTER TABLE IF EXISTS clinical.tasks      RENAME COLUMN admission_id TO encounter_id;
ALTER TABLE IF EXISTS clinical.orders     RENAME COLUMN admission_id TO encounter_id;
ALTER TABLE IF EXISTS clinical.notes      RENAME COLUMN admission_id TO encounter_id;
ALTER TABLE IF EXISTS clinical.diagnoses  RENAME COLUMN admission_id TO encounter_id;

ALTER TABLE IF EXISTS clinical.admissions RENAME TO encounters;

-- Recreates structure only; data migrated to jsonb is lost
ALTER TABLE IF EXISTS clinical.patients DROP COLUMN IF EXISTS allergies;
CREATE TABLE IF NOT EXISTS clinical.patient_allergies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid        NOT NULL REFERENCES clinical.patients (id),
  allergen    text        NOT NULL,
  reaction    text,
  severity    text        CHECK (severity IN ('mild', 'moderate', 'severe')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL REFERENCES staff.users (id),
  UNIQUE (patient_id, allergen)
);
