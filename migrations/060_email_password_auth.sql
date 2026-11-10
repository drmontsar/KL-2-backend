-- up
-- Existing phone numbers remain contact details; credentials are kept separate
-- so staff SELECT * responses cannot accidentally expose password hashes.
ALTER TABLE staff.users ALTER COLUMN phone DROP NOT NULL;
CREATE TABLE staff.user_credentials (
  user_id uuid PRIMARY KEY REFERENCES staff.users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) > 3),
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_credentials_email_unique ON staff.user_credentials (email);
-- Existing OTP-issued sessions must not survive the authentication change.
DELETE FROM staff.sessions;

-- down
-- Only possible if all users have contact phone numbers.
DROP TABLE staff.user_credentials;
ALTER TABLE staff.users ALTER COLUMN phone SET NOT NULL;
