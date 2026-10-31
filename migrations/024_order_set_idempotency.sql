-- up
CREATE TABLE clinical.order_set_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES staff.users(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_hash text NOT NULL,
  order_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, idempotency_key)
);

-- down
DROP TABLE IF EXISTS clinical.order_set_applications;
