-- up
CREATE TABLE clinical.order_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinical.order_set_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_set_id uuid NOT NULL REFERENCES clinical.order_sets(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('medication','investigation','nursing','laboratory','imaging','respiratory','diet','clinical')),
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent','stat')),
  payload jsonb NOT NULL,
  UNIQUE (order_set_id, position)
);

ALTER TABLE clinical.orders ADD COLUMN order_set_item_id uuid REFERENCES clinical.order_set_items(id);

-- down
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS order_set_item_id;
DROP TABLE IF EXISTS clinical.order_set_items;
DROP TABLE IF EXISTS clinical.order_sets;
