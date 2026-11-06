-- up
-- Keep lifecycle status ('active'/'discharged') for existing clinical workflows;
-- arrival_status tracks whether the reserved bed is actually occupied.
ALTER TABLE clinical.admissions ADD COLUMN arrival_status text NOT NULL DEFAULT 'admitted'
  CHECK (arrival_status IN ('incoming', 'admitted'));
ALTER TABLE clinical.admissions ADD COLUMN arrived_at timestamptz DEFAULT now();
UPDATE clinical.admissions SET arrived_at = admitted_at;
ALTER TABLE clinical.admissions ADD CONSTRAINT admission_arrival_consistent
  CHECK ((arrival_status = 'incoming' AND arrived_at IS NULL)
      OR (arrival_status = 'admitted' AND arrived_at IS NOT NULL));

-- down
ALTER TABLE clinical.admissions DROP COLUMN arrived_at;
ALTER TABLE clinical.admissions DROP COLUMN arrival_status;
