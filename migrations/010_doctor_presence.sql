-- up
ALTER TABLE staff.users
  ADD COLUMN current_area  varchar(50),
  ADD COLUMN last_seen_at  timestamptz;

-- down
ALTER TABLE staff.users
  DROP COLUMN IF EXISTS current_area,
  DROP COLUMN IF EXISTS last_seen_at;
