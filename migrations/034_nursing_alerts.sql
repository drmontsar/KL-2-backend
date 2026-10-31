-- up
ALTER TABLE clinical.alerts DROP CONSTRAINT alerts_type_check;
ALTER TABLE clinical.alerts ADD CONSTRAINT alerts_type_check CHECK (type IN ('news2', 'low_urine_output'));
CREATE UNIQUE INDEX one_open_low_urine_alert_per_admission
  ON clinical.alerts (admission_id, type)
  WHERE type = 'low_urine_output' AND status IN ('active','acknowledged');

-- down
DROP INDEX IF EXISTS clinical.one_open_low_urine_alert_per_admission;
ALTER TABLE clinical.alerts DROP CONSTRAINT alerts_type_check;
ALTER TABLE clinical.alerts ADD CONSTRAINT alerts_type_check CHECK (type IN ('news2'));
