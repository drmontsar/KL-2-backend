-- up
ALTER TABLE clinical.medication_schedules
  ADD COLUMN prn_min_interval_minutes integer,
  ADD COLUMN prn_max_doses_24h integer,
  ADD CONSTRAINT medication_prn_limits CHECK (
    (prn_indication IS NULL AND prn_min_interval_minutes IS NULL AND prn_max_doses_24h IS NULL)
    OR (prn_indication IS NOT NULL AND prn_min_interval_minutes IS NOT NULL AND prn_min_interval_minutes BETWEEN 1 AND 10080 AND prn_max_doses_24h IS NOT NULL AND prn_max_doses_24h BETWEEN 1 AND 100)
  ) NOT VALID;
ALTER TABLE clinical.medication_doses ADD COLUMN administration_reason text;

-- down
ALTER TABLE clinical.medication_doses DROP COLUMN IF EXISTS administration_reason;
ALTER TABLE clinical.medication_schedules DROP CONSTRAINT IF EXISTS medication_prn_limits;
ALTER TABLE clinical.medication_schedules DROP COLUMN IF EXISTS prn_max_doses_24h;
ALTER TABLE clinical.medication_schedules DROP COLUMN IF EXISTS prn_min_interval_minutes;
