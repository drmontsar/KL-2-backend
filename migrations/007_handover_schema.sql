-- up

-- severity triage on admissions
ALTER TABLE clinical.admissions
  ADD COLUMN severity  text NOT NULL DEFAULT 'stable'
    CHECK (severity IN ('unstable','watcher','stable')),
  ADD COLUMN exit_type text CHECK (exit_type IN ('discharged','transfer_team','transfer_out','lama','died')),
  ADD COLUMN exit_dest text,
  ADD COLUMN exit_note text;

-- read-back text captured when nurse acknowledges a handoff
ALTER TABLE clinical.handoffs
  ADD COLUMN readback text;

-- what changed this shift (highlighted text on patient summary)
ALTER TABLE clinical.notes
  ADD COLUMN changed_text text;

-- if/then contingencies per admission
CREATE TABLE IF NOT EXISTS clinical.contingencies (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid        NOT NULL REFERENCES clinical.admissions(id) ON DELETE CASCADE,
  body         text        NOT NULL,
  created_by   uuid        NOT NULL REFERENCES staff.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contingencies_admission ON clinical.contingencies (admission_id);

-- timestamped shift event log per admission
CREATE TABLE IF NOT EXISTS clinical.shift_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid        NOT NULL REFERENCES clinical.admissions(id) ON DELETE CASCADE,
  body         text        NOT NULL,
  logged_by    uuid        NOT NULL REFERENCES staff.users(id),
  logged_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_events_admission ON clinical.shift_events (admission_id);

-- down

DROP TABLE IF EXISTS clinical.shift_events;
DROP TABLE IF EXISTS clinical.contingencies;
ALTER TABLE clinical.notes     DROP COLUMN IF EXISTS changed_text;
ALTER TABLE clinical.handoffs  DROP COLUMN IF EXISTS readback;
ALTER TABLE clinical.admissions
  DROP COLUMN IF EXISTS exit_note,
  DROP COLUMN IF EXISTS exit_dest,
  DROP COLUMN IF EXISTS exit_type,
  DROP COLUMN IF EXISTS severity;
