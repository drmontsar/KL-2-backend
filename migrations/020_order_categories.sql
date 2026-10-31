-- up
ALTER TABLE clinical.orders DROP CONSTRAINT IF EXISTS orders_kind_check;
ALTER TABLE clinical.orders ADD CONSTRAINT orders_kind_check
  CHECK (kind IN ('medication','investigation','nursing','laboratory','imaging','respiratory','diet','clinical'));

-- down
ALTER TABLE clinical.orders DROP CONSTRAINT IF EXISTS orders_kind_check;
ALTER TABLE clinical.orders ADD CONSTRAINT orders_kind_check
  CHECK (kind IN ('medication','investigation','nursing'));
