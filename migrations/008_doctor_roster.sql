-- up

ALTER TABLE clinical.admissions
  ADD COLUMN assigned_doctor_id uuid REFERENCES staff.users(id);

CREATE INDEX IF NOT EXISTS admissions_doctor_active
  ON clinical.admissions (assigned_doctor_id) WHERE status = 'active';

-- down

DROP INDEX IF EXISTS admissions_doctor_active;
ALTER TABLE clinical.admissions DROP COLUMN IF EXISTS assigned_doctor_id;
