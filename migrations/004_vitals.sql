-- up

CREATE TABLE IF NOT EXISTS clinical.vitals (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id   uuid        NOT NULL REFERENCES clinical.admissions(id),
  recorded_by    uuid        NOT NULL REFERENCES staff.users(id),
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  bp_systolic    int,
  bp_diastolic   int,
  heart_rate     int,
  spo2           numeric(4,1),
  resp_rate      int,
  temperature    numeric(4,1),
  glucose        int
);

CREATE INDEX IF NOT EXISTS vitals_admission_time
  ON clinical.vitals (admission_id, recorded_at DESC);

-- down

DROP TABLE IF EXISTS clinical.vitals;
