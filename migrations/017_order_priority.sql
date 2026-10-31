-- up
ALTER TABLE clinical.orders
  ADD COLUMN priority text NOT NULL DEFAULT 'routine'
  CHECK (priority IN ('routine', 'urgent', 'stat'));

-- down
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS priority;
