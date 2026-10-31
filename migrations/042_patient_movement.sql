-- up
CREATE TABLE clinical.patient_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  movement_type text NOT NULL CHECK (movement_type IN ('permanent','temporary')),
  destination_unit_id uuid REFERENCES organization.units(id),
  destination_area text,
  source_bed_id uuid REFERENCES organization.beds(id),
  destination_bed_id uuid REFERENCES organization.beds(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  escort text NOT NULL CHECK (escort IN ('porter','nurse','doctor')),
  equipment jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','reserved','in_transit','arrived','returned','cancelled')),
  requested_by uuid NOT NULL REFERENCES staff.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reserved_by uuid REFERENCES staff.users(id),
  departed_at timestamptz,
  completed_at timestamptz,
  CHECK ((movement_type = 'temporary' AND destination_area IS NOT NULL AND destination_unit_id IS NULL AND destination_bed_id IS NULL)
      OR (movement_type = 'permanent' AND destination_area IS NULL AND destination_unit_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_patient_movement ON clinical.patient_movements (admission_id)
  WHERE status IN ('requested','reserved','in_transit');
CREATE TABLE organization.bed_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bed_id uuid NOT NULL REFERENCES organization.beds(id),
  movement_id uuid NOT NULL UNIQUE REFERENCES clinical.patient_movements(id),
  reserved_by uuid NOT NULL REFERENCES staff.users(id),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE UNIQUE INDEX one_active_bed_reservation ON organization.bed_reservations (bed_id) WHERE released_at IS NULL;

-- down
DROP TABLE IF EXISTS organization.bed_reservations;
DROP TABLE IF EXISTS clinical.patient_movements;
