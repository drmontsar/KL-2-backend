-- up
CREATE TABLE clinical.discharge_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  discharge_type text NOT NULL CHECK (discharge_type IN ('home','referral','lama')),
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','completed','cancelled')),
  planned_at timestamptz NOT NULL,
  condition text NOT NULL,
  follow_up text NOT NULL,
  form_version_id uuid REFERENCES forms.instance_versions(id),
  summary text,
  summary_signed_by uuid REFERENCES staff.users(id),
  summary_signed_at timestamptz,
  requested_by uuid NOT NULL REFERENCES staff.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES staff.users(id),
  approved_at timestamptz,
  completed_by uuid REFERENCES staff.users(id),
  completed_at timestamptz,
  revision integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX one_open_discharge_plan ON clinical.discharge_plans (admission_id) WHERE status IN ('pending_approval','approved');
CREATE TABLE clinical.discharge_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES clinical.discharge_plans(id),
  code text NOT NULL CHECK (code IN ('summary','pending_results','medication_reconciliation','nursing','billing','insurance','payment')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  evidence text,
  completed_by uuid REFERENCES staff.users(id),
  completed_at timestamptz,
  UNIQUE (plan_id, code),
  CHECK ((status = 'pending' AND completed_by IS NULL AND completed_at IS NULL) OR (status = 'completed' AND completed_by IS NOT NULL AND completed_at IS NOT NULL AND evidence IS NOT NULL))
);

-- down
DROP TABLE IF EXISTS clinical.discharge_tasks;
DROP TABLE IF EXISTS clinical.discharge_plans;
