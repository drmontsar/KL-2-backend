-- up
CREATE SCHEMA IF NOT EXISTS finance;
CREATE TABLE finance.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL UNIQUE REFERENCES clinical.admissions(id),
  coverage_id uuid NOT NULL REFERENCES clinical.patient_coverage(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','preauthorization_sent','query_raised','approved','discharge_billed')),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  approved_limit numeric(12,2) NOT NULL DEFAULT 0 CHECK (approved_limit >= 0),
  current_usage numeric(12,2) NOT NULL DEFAULT 0 CHECK (current_usage >= 0),
  estimate numeric(12,2) NOT NULL DEFAULT 0 CHECK (estimate >= 0),
  final_approved boolean NOT NULL DEFAULT false,
  enhancement_pending boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE finance.claim_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES finance.claims(id),
  question text NOT NULL,
  reply text,
  raised_by uuid NOT NULL REFERENCES staff.users(id),
  raised_at timestamptz NOT NULL DEFAULT now(),
  replied_by uuid REFERENCES staff.users(id),
  replied_at timestamptz
);
CREATE UNIQUE INDEX one_open_claim_query ON finance.claim_queries (claim_id) WHERE replied_at IS NULL;
CREATE TABLE finance.claim_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES finance.claims(id),
  type text NOT NULL,
  note text NOT NULL DEFAULT '',
  actor_id uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_events_claim_time ON finance.claim_events (claim_id, created_at DESC);
CREATE TABLE finance.deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reference text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admission_id, reference)
);

-- down
DROP TABLE IF EXISTS finance.deposits;
DROP TABLE IF EXISTS finance.claim_events;
DROP TABLE IF EXISTS finance.claim_queries;
DROP TABLE IF EXISTS finance.claims;
DROP SCHEMA IF EXISTS finance;
