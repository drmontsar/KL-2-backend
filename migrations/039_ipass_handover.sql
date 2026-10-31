-- up
CREATE TABLE clinical.ipass_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outgoing_doctor_id uuid NOT NULL REFERENCES staff.users(id),
  incoming_doctor_id uuid NOT NULL REFERENCES staff.users(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz,
  CHECK (outgoing_doctor_id <> incoming_doctor_id)
);
CREATE TABLE clinical.ipass_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES clinical.ipass_sessions(id),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  patient_name text NOT NULL,
  ward text,
  bed text,
  severity text NOT NULL CHECK (severity IN ('stable','watcher','unstable')),
  patient_summary text NOT NULL DEFAULT '',
  action_list text NOT NULL DEFAULT '',
  contingency text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed','accepted','cancelled')),
  snapshot_revision bigint NOT NULL,
  signed_at timestamptz,
  readback text,
  accepted_at timestamptz,
  UNIQUE (session_id, admission_id)
);
CREATE UNIQUE INDEX ipass_one_pending_item_per_admission ON clinical.ipass_items (admission_id)
  WHERE status IN ('draft','signed');
CREATE TABLE clinical.ipass_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES clinical.ipass_items(id),
  author_id uuid NOT NULL REFERENCES staff.users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- down
DROP TABLE IF EXISTS clinical.ipass_questions;
DROP TABLE IF EXISTS clinical.ipass_items;
DROP TABLE IF EXISTS clinical.ipass_sessions;
