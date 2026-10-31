-- up
CREATE TABLE clinical.cross_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  requested_by uuid NOT NULL REFERENCES staff.users(id),
  consultant_id uuid NOT NULL REFERENCES staff.users(id),
  specialty text NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('routine','urgent','emergency')),
  question text NOT NULL,
  findings text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','seen','opinion','acknowledged','closed','withdrawn')),
  impression text,
  recommendations text,
  call_again text,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  opinion_at timestamptz,
  opinion_note_id uuid REFERENCES clinical.notes(id),
  acknowledged_by uuid REFERENCES staff.users(id),
  acknowledged_at timestamptz,
  closed_at timestamptz
);
CREATE UNIQUE INDEX one_open_cross_referral_per_consultant
  ON clinical.cross_referrals (admission_id, consultant_id)
  WHERE status IN ('sent','seen','opinion','acknowledged');
CREATE INDEX cross_referrals_consultant_status ON clinical.cross_referrals (consultant_id, status, created_at);
CREATE INDEX cross_referrals_admission ON clinical.cross_referrals (admission_id, created_at DESC);
ALTER TABLE clinical.orders ADD COLUMN cross_referral_id uuid REFERENCES clinical.cross_referrals(id);

-- down
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS cross_referral_id;
DROP TABLE IF EXISTS clinical.cross_referrals;
