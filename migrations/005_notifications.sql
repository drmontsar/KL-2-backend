-- up

CREATE TABLE IF NOT EXISTS clinical.notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES staff.users(id),
  type       text        NOT NULL,
  payload    jsonb       NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread
  ON clinical.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- down

DROP TABLE IF EXISTS clinical.notifications;
