-- up

CREATE SCHEMA IF NOT EXISTS organization;

CREATE TABLE organization.facilities (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        NOT NULL UNIQUE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization.departments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid        NOT NULL REFERENCES organization.facilities(id),
  code        text        NOT NULL,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, code)
);

CREATE TABLE organization.units (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid        NOT NULL REFERENCES organization.departments(id),
  code          text        NOT NULL,
  name          text        NOT NULL,
  kind          text        NOT NULL DEFAULT 'inpatient'
                            CHECK (kind IN ('inpatient','icu','emergency','opd','procedure')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, code)
);

CREATE TABLE organization.wards (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    uuid        NOT NULL REFERENCES organization.units(id),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, name)
);

CREATE TABLE organization.rooms (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id    uuid        NOT NULL REFERENCES organization.wards(id),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ward_id, name)
);

CREATE TABLE organization.beds (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id           uuid        NOT NULL REFERENCES organization.rooms(id),
  label             text        NOT NULL,
  operational_state text        NOT NULL DEFAULT 'available'
                                CHECK (operational_state IN ('available','cleaning','out_of_service')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, label)
);

ALTER TABLE clinical.admissions
  ADD COLUMN bed_id uuid REFERENCES organization.beds(id);

CREATE UNIQUE INDEX one_active_admission_per_bed
  ON clinical.admissions (bed_id)
  WHERE status = 'active' AND bed_id IS NOT NULL;

-- Preserve existing ward/bed strings by placing them under a default hierarchy.
WITH facility AS (
  INSERT INTO organization.facilities (code, name)
  VALUES ('DEFAULT', 'KliniK Hospital')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
), department AS (
  INSERT INTO organization.departments (facility_id, code, name)
  SELECT id, 'INPATIENT', 'Inpatient Services' FROM facility
  ON CONFLICT (facility_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
), unit AS (
  INSERT INTO organization.units (department_id, code, name)
  SELECT id, 'INPATIENT', 'Inpatient' FROM department
  ON CONFLICT (department_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
)
INSERT INTO organization.wards (unit_id, name)
SELECT unit.id, source.ward
FROM unit
CROSS JOIN (
  SELECT DISTINCT ward FROM clinical.admissions WHERE ward IS NOT NULL
) source
ON CONFLICT (unit_id, name) DO NOTHING;

INSERT INTO organization.rooms (ward_id, name)
SELECT w.id, 'Default'
FROM organization.wards w
ON CONFLICT (ward_id, name) DO NOTHING;

INSERT INTO organization.beds (room_id, label)
SELECT r.id, source.bed
FROM (
  SELECT DISTINCT ward, bed
  FROM clinical.admissions
  WHERE ward IS NOT NULL AND bed IS NOT NULL
) source
JOIN organization.wards w ON w.name = source.ward
JOIN organization.rooms r ON r.ward_id = w.id AND r.name = 'Default'
ON CONFLICT (room_id, label) DO NOTHING;

UPDATE clinical.admissions a
SET bed_id = b.id
FROM organization.beds b
JOIN organization.rooms r ON r.id = b.room_id
JOIN organization.wards w ON w.id = r.ward_id
WHERE a.ward = w.name AND a.bed = b.label;

-- down

DROP INDEX IF EXISTS clinical.one_active_admission_per_bed;
ALTER TABLE clinical.admissions DROP COLUMN IF EXISTS bed_id;
DROP TABLE IF EXISTS organization.beds;
DROP TABLE IF EXISTS organization.rooms;
DROP TABLE IF EXISTS organization.wards;
DROP TABLE IF EXISTS organization.units;
DROP TABLE IF EXISTS organization.departments;
DROP TABLE IF EXISTS organization.facilities;
DROP SCHEMA IF EXISTS organization;
