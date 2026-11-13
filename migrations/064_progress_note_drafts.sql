-- up
ALTER TABLE clinical.notes ADD COLUMN documentation_status text NOT NULL DEFAULT 'saved' CHECK (documentation_status IN ('draft','saved'));
ALTER TABLE clinical.notes ADD COLUMN saved_at timestamptz;
ALTER TABLE clinical.notes ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE clinical.notes ADD COLUMN author_stamp jsonb;
UPDATE clinical.notes SET saved_at = created_at, updated_at = created_at;

-- down
ALTER TABLE clinical.notes DROP COLUMN author_stamp;
ALTER TABLE clinical.notes DROP COLUMN updated_at;
ALTER TABLE clinical.notes DROP COLUMN saved_at;
ALTER TABLE clinical.notes DROP COLUMN documentation_status;
