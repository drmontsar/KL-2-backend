-- up
CREATE TABLE clinical.initial_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL UNIQUE REFERENCES clinical.admissions(id),
  chief_complaint text NOT NULL CHECK (length(btrim(chief_complaint)) > 0),
  history text NOT NULL CHECK (length(btrim(history)) > 0),
  examination text NOT NULL CHECK (length(btrim(examination)) > 0),
  clinical_impression text NOT NULL CHECK (length(btrim(clinical_impression)) > 0),
  plan text NOT NULL CHECK (length(btrim(plan)) > 0),
  assessed_by uuid NOT NULL REFERENCES staff.users(id),
  signed_at timestamptz NOT NULL DEFAULT now()
);

-- down
DROP TABLE clinical.initial_assessments;
