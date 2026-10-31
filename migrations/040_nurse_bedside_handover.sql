-- up
CREATE TABLE clinical.nurse_handover_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outgoing_nurse_id uuid NOT NULL REFERENCES staff.users(id),
  incoming_nurse_id uuid NOT NULL REFERENCES staff.users(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz,
  CHECK (outgoing_nurse_id <> incoming_nurse_id)
);
CREATE TABLE clinical.nurse_handover_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES clinical.nurse_handover_sessions(id),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  patient_name text NOT NULL,
  ward text,
  bed text,
  snapshot jsonb NOT NULL,
  handover_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','accepted','cancelled')),
  checklist jsonb,
  discrepancies text,
  accepted_at timestamptz,
  UNIQUE (session_id, admission_id)
);
CREATE UNIQUE INDEX nurse_handover_one_open_item_per_admission ON clinical.nurse_handover_items (admission_id) WHERE status = 'draft';
CREATE TABLE clinical.nurse_handover_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES clinical.nurse_handover_items(id),
  author_id uuid NOT NULL REFERENCES staff.users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- down
DROP TABLE IF EXISTS clinical.nurse_handover_questions;
DROP TABLE IF EXISTS clinical.nurse_handover_items;
DROP TABLE IF EXISTS clinical.nurse_handover_sessions;
