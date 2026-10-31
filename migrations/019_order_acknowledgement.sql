-- up
ALTER TABLE clinical.orders
  ADD COLUMN acknowledged_by uuid REFERENCES staff.users(id),
  ADD COLUMN acknowledged_at timestamptz,
  ADD CONSTRAINT order_acknowledgement_complete CHECK (
    (acknowledged_by IS NULL AND acknowledged_at IS NULL)
    OR (acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL)
  );

-- down
ALTER TABLE clinical.orders
  DROP CONSTRAINT IF EXISTS order_acknowledgement_complete,
  DROP COLUMN IF EXISTS acknowledged_at,
  DROP COLUMN IF EXISTS acknowledged_by;
