-- up
ALTER TABLE clinical.fluid_entries DROP CONSTRAINT fluid_entries_volume_ml_check;
ALTER TABLE clinical.fluid_entries ADD CONSTRAINT fluid_entries_volume_ml_check
  CHECK (volume_ml <= 10000 AND (volume_ml > 0 OR (volume_ml = 0 AND direction = 'output')));

-- down
ALTER TABLE clinical.fluid_entries DROP CONSTRAINT fluid_entries_volume_ml_check;
ALTER TABLE clinical.fluid_entries ADD CONSTRAINT fluid_entries_volume_ml_check
  CHECK (volume_ml > 0 AND volume_ml <= 10000);
