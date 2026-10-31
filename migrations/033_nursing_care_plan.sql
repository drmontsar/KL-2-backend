-- up
CREATE TABLE clinical.nursing_care_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  problem text NOT NULL CHECK (length(trim(problem)) > 0),
  intervention text NOT NULL CHECK (length(trim(intervention)) > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES staff.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES staff.users(id),
  updated_at timestamptz,
  resolution_reason text,
  CHECK (status <> 'resolved' OR (resolution_reason IS NOT NULL AND length(trim(resolution_reason)) > 0))
);
CREATE INDEX nursing_care_plan_admission ON clinical.nursing_care_plan_items (admission_id, status, created_at DESC);

-- down
DROP TABLE IF EXISTS clinical.nursing_care_plan_items;
