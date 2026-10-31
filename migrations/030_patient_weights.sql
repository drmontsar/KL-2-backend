-- up
CREATE TABLE clinical.patient_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  weight_kg double precision NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 500),
  measured_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES staff.users(id)
);
CREATE INDEX patient_weights_admission_time ON clinical.patient_weights (admission_id, measured_at DESC);

-- down
DROP TABLE IF EXISTS clinical.patient_weights;
