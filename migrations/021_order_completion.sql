-- up
ALTER TABLE clinical.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE clinical.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft', 'confirmed', 'cancelled', 'completed', 'discontinued'));
ALTER TABLE clinical.orders
  ADD COLUMN closed_by uuid REFERENCES staff.users(id),
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN close_reason text;

-- down
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS close_reason;
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS closed_at;
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS closed_by;
ALTER TABLE clinical.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE clinical.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft', 'confirmed', 'cancelled'));
