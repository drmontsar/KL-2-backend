-- up
CREATE TABLE clinical.nursing_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  assessed_by uuid NOT NULL REFERENCES staff.users(id),
  assessed_at timestamptz NOT NULL DEFAULT now(),
  arrival_source text NOT NULL,
  transport_mode text NOT NULL,
  identity_verified boolean NOT NULL CHECK (identity_verified),
  allergy_verified boolean NOT NULL CHECK (allergy_verified),
  language text NOT NULL DEFAULT '',
  belongings text NOT NULL DEFAULT '',
  dependence text NOT NULL,
  skin text NOT NULL,
  vulnerabilities jsonb NOT NULL DEFAULT '[]',
  devices jsonb NOT NULL DEFAULT '[]',
  pain_score integer NOT NULL CHECK (pain_score BETWEEN 0 AND 10),
  pain_site text NOT NULL DEFAULT '',
  morse jsonb NOT NULL,
  morse_score integer NOT NULL CHECK (morse_score BETWEEN 0 AND 125),
  braden jsonb NOT NULL,
  braden_score integer NOT NULL CHECK (braden_score BETWEEN 6 AND 23),
  must jsonb NOT NULL,
  must_score integer NOT NULL CHECK (must_score BETWEEN 0 AND 6),
  care_plan jsonb NOT NULL,
  reassess_by timestamptz NOT NULL
);
CREATE INDEX nursing_assessments_admission_time ON clinical.nursing_assessments (admission_id, assessed_at DESC);

CREATE TABLE clinical.nursing_recurring_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  source_assessment_id uuid REFERENCES clinical.nursing_assessments(id),
  description text NOT NULL,
  interval_minutes integer NOT NULL CHECK (interval_minutes BETWEEN 5 AND 10080),
  due_at timestamptz NOT NULL,
  last_completed_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nursing_recurring_tasks_due ON clinical.nursing_recurring_tasks (admission_id, due_at) WHERE status = 'active';
CREATE TABLE clinical.nursing_task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES clinical.nursing_recurring_tasks(id),
  completed_by uuid NOT NULL REFERENCES staff.users(id),
  completed_at timestamptz NOT NULL DEFAULT now(),
  previous_due_at timestamptz NOT NULL
);

CREATE TABLE clinical.fluid_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  recorded_by uuid NOT NULL REFERENCES staff.users(id),
  direction text NOT NULL CHECK (direction IN ('intake','output')),
  category text NOT NULL,
  volume_ml double precision NOT NULL CHECK (volume_ml > 0 AND volume_ml <= 10000),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fluid_entries_admission_time ON clinical.fluid_entries (admission_id, occurred_at DESC);

CREATE TABLE clinical.nursing_sbar_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  called_by uuid NOT NULL REFERENCES staff.users(id),
  doctor_id uuid NOT NULL REFERENCES staff.users(id),
  situation text NOT NULL,
  background text NOT NULL,
  assessment text NOT NULL,
  request text NOT NULL CHECK (request IN ('immediate','within_30_minutes','telephone_advice')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  reply text,
  closed_by uuid REFERENCES staff.users(id),
  closed_at timestamptz
);
CREATE INDEX nursing_sbar_doctor_status ON clinical.nursing_sbar_calls (doctor_id, status, created_at DESC);

-- down
DROP TABLE IF EXISTS clinical.nursing_sbar_calls;
DROP TABLE IF EXISTS clinical.fluid_entries;
DROP TABLE IF EXISTS clinical.nursing_task_completions;
DROP TABLE IF EXISTS clinical.nursing_recurring_tasks;
DROP TABLE IF EXISTS clinical.nursing_assessments;
