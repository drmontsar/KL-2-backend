-- up
ALTER TABLE clinical.notifications
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN closed_at timestamptz;

-- down
ALTER TABLE clinical.notifications
  DROP COLUMN IF EXISTS closed_at,
  DROP COLUMN IF EXISTS acknowledged_at;
