-- up
CREATE TABLE clinical.consultant_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  consultant_id uuid NOT NULL REFERENCES staff.users(id),
  subjective text NOT NULL DEFAULT '',
  objective text NOT NULL DEFAULT '',
  assessment text NOT NULL,
  plan text NOT NULL,
  note_id uuid NOT NULL REFERENCES clinical.notes(id),
  signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consultant_rounds_patient ON clinical.consultant_rounds (admission_id, signed_at DESC);
ALTER TABLE clinical.orders ADD COLUMN consultant_round_id uuid REFERENCES clinical.consultant_rounds(id);

-- down
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS consultant_round_id;
DROP TABLE IF EXISTS clinical.consultant_rounds;
