-- up
CREATE TABLE clinical.medication_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  order_id uuid NOT NULL UNIQUE REFERENCES clinical.orders(id),
  drug text NOT NULL,
  dose text NOT NULL,
  route text NOT NULL,
  prn_indication text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE clinical.medication_doses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES clinical.medication_schedules(id),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'given', 'held')),
  acted_by uuid REFERENCES staff.users(id),
  acted_at timestamptz,
  hold_reason text,
  CHECK ((status = 'scheduled' AND acted_by IS NULL AND acted_at IS NULL AND hold_reason IS NULL)
      OR (status = 'given' AND acted_by IS NOT NULL AND acted_at IS NOT NULL AND hold_reason IS NULL)
      OR (status = 'held' AND acted_by IS NOT NULL AND acted_at IS NOT NULL AND hold_reason IS NOT NULL AND length(trim(hold_reason)) > 0)),
  UNIQUE (schedule_id, due_at)
);
CREATE INDEX medication_doses_due ON clinical.medication_doses (due_at) WHERE status = 'scheduled';

CREATE TABLE clinical.medication_allergy_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES clinical.medication_schedules(id),
  patient_revision bigint NOT NULL,
  decision text NOT NULL CHECK (decision IN ('safe', 'contraindicated')),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  reviewed_by uuid NOT NULL REFERENCES staff.users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medication_allergy_reviews_schedule ON clinical.medication_allergy_reviews (schedule_id, reviewed_at DESC);

CREATE TABLE clinical.infusion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES clinical.medication_schedules(id),
  action text NOT NULL CHECK (action IN ('start', 'rate_change', 'stop')),
  rate text,
  reason text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES staff.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((action IN ('start','rate_change') AND rate IS NOT NULL AND length(trim(rate)) > 0) OR (action = 'stop' AND rate IS NULL))
);
CREATE INDEX infusion_events_schedule ON clinical.infusion_events (schedule_id, recorded_at DESC);

-- down
DROP TABLE IF EXISTS clinical.infusion_events;
DROP TABLE IF EXISTS clinical.medication_allergy_reviews;
DROP TABLE IF EXISTS clinical.medication_doses;
DROP TABLE IF EXISTS clinical.medication_schedules;
