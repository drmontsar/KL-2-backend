-- up
ALTER TABLE clinical.medication_doses DROP CONSTRAINT medication_doses_status_check;
ALTER TABLE clinical.medication_doses DROP CONSTRAINT medication_doses_check;
ALTER TABLE clinical.medication_doses ADD CONSTRAINT medication_doses_status_check
  CHECK (status IN ('scheduled', 'given', 'held', 'missed'));
ALTER TABLE clinical.medication_doses ADD CONSTRAINT medication_doses_check
  CHECK ((status = 'scheduled' AND acted_by IS NULL AND acted_at IS NULL AND hold_reason IS NULL)
      OR (status = 'given' AND acted_by IS NOT NULL AND acted_at IS NOT NULL AND hold_reason IS NULL)
      OR (status IN ('held', 'missed') AND acted_by IS NOT NULL AND acted_at IS NOT NULL
          AND hold_reason IS NOT NULL AND length(trim(hold_reason)) > 0));

-- down
ALTER TABLE clinical.medication_doses DROP CONSTRAINT medication_doses_status_check;
ALTER TABLE clinical.medication_doses DROP CONSTRAINT medication_doses_check;
ALTER TABLE clinical.medication_doses ADD CONSTRAINT medication_doses_status_check
  CHECK (status IN ('scheduled', 'given', 'held'));
ALTER TABLE clinical.medication_doses ADD CONSTRAINT medication_doses_check
  CHECK ((status = 'scheduled' AND acted_by IS NULL AND acted_at IS NULL AND hold_reason IS NULL)
      OR (status = 'given' AND acted_by IS NOT NULL AND acted_at IS NOT NULL AND hold_reason IS NULL)
      OR (status = 'held' AND acted_by IS NOT NULL AND acted_at IS NOT NULL
          AND hold_reason IS NOT NULL AND length(trim(hold_reason)) > 0));
