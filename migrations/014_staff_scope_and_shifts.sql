-- up

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE staff.users
  ADD COLUMN job_role text,
  ADD CONSTRAINT users_job_role CHECK (job_role IN (
    'duty_doctor','consultant','staff_nurse','pharmacist',
    'billing_insurance','bed_desk','administrator'
  ));

UPDATE staff.users
SET job_role = CASE role
  WHEN 'doctor' THEN 'duty_doctor'
  WHEN 'nurse' THEN 'staff_nurse'
  ELSE 'administrator'
END;

ALTER TABLE staff.users ALTER COLUMN job_role SET NOT NULL;

CREATE TABLE staff.unit_memberships (
  user_id    uuid        NOT NULL REFERENCES staff.users(id),
  unit_id    uuid        NOT NULL REFERENCES organization.units(id),
  is_primary boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, unit_id)
);

CREATE TABLE staff.shifts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES staff.users(id),
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  status     text        NOT NULL DEFAULT 'scheduled'
                         CHECK (status IN ('scheduled','active','completed','cancelled')),
  created_by uuid        REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('scheduled','active'))
);
CREATE UNIQUE INDEX one_active_shift_per_user
  ON staff.shifts (user_id) WHERE status = 'active';
CREATE INDEX shifts_user_time ON staff.shifts (user_id, starts_at DESC);

CREATE TABLE staff.shift_units (
  shift_id uuid NOT NULL REFERENCES staff.shifts(id) ON DELETE CASCADE,
  unit_id  uuid NOT NULL REFERENCES organization.units(id),
  PRIMARY KEY (shift_id, unit_id)
);

ALTER TABLE clinical.admissions
  ADD COLUMN unit_id uuid REFERENCES organization.units(id);

UPDATE clinical.admissions a
SET unit_id = w.unit_id
FROM organization.beds b
JOIN organization.rooms r ON r.id = b.room_id
JOIN organization.wards w ON w.id = r.ward_id
WHERE a.bed_id = b.id;

CREATE INDEX admissions_unit_active
  ON clinical.admissions (unit_id) WHERE status = 'active';

CREATE TABLE clinical.staff_assignments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id    uuid        NOT NULL REFERENCES clinical.admissions(id),
  user_id         uuid        NOT NULL REFERENCES staff.users(id),
  assignment_type text        NOT NULL CHECK (assignment_type IN (
    'treating_consultant','duty_doctor','primary_nurse','coverage'
  )),
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz,
  assigned_by     uuid        REFERENCES staff.users(id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX unique_active_staff_assignment
  ON clinical.staff_assignments (admission_id, user_id, assignment_type)
  WHERE ends_at IS NULL;
CREATE INDEX staff_assignments_user_active
  ON clinical.staff_assignments (user_id, admission_id) WHERE ends_at IS NULL;

INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type)
SELECT a.id, a.assigned_doctor_id,
       CASE WHEN u.job_role = 'consultant' THEN 'treating_consultant' ELSE 'duty_doctor' END
FROM clinical.admissions a
JOIN staff.users u ON u.id = a.assigned_doctor_id
WHERE a.assigned_doctor_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type)
SELECT a.id, a.assigned_to, 'primary_nurse'
FROM clinical.admissions a
WHERE assigned_to IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE clinical.break_glass_access (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES staff.users(id),
  admission_id uuid        NOT NULL REFERENCES clinical.admissions(id),
  reason       text        NOT NULL CHECK (length(trim(reason)) >= 10),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  CHECK (expires_at > granted_at)
);
CREATE INDEX break_glass_active
  ON clinical.break_glass_access (user_id, admission_id, expires_at)
  WHERE revoked_at IS NULL;

-- down

DROP TABLE IF EXISTS clinical.break_glass_access;
DROP TABLE IF EXISTS clinical.staff_assignments;
DROP INDEX IF EXISTS clinical.admissions_unit_active;
ALTER TABLE clinical.admissions DROP COLUMN IF EXISTS unit_id;
DROP TABLE IF EXISTS staff.shift_units;
DROP TABLE IF EXISTS staff.shifts;
DROP TABLE IF EXISTS staff.unit_memberships;
ALTER TABLE staff.users DROP CONSTRAINT IF EXISTS users_job_role;
ALTER TABLE staff.users DROP COLUMN IF EXISTS job_role;
