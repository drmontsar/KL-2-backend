-- up

-- Phone must be unique to use as login identifier
ALTER TABLE staff.users
  ALTER COLUMN phone SET NOT NULL,
  ADD CONSTRAINT users_phone_unique UNIQUE (phone);

-- Sessions: one row per active login token
CREATE TABLE IF NOT EXISTS staff.sessions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES staff.users(id) ON DELETE CASCADE,
  token      text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS sessions_token   ON staff.sessions (token);
CREATE INDEX IF NOT EXISTS sessions_user_id ON staff.sessions (user_id);

-- down

DROP TABLE IF EXISTS staff.sessions;
ALTER TABLE staff.users DROP CONSTRAINT IF EXISTS users_phone_unique;
ALTER TABLE staff.users ALTER COLUMN phone DROP NOT NULL;
