-- up
CREATE UNIQUE INDEX one_abha_identifier_per_patient
  ON clinical.patient_identifiers (patient_id) WHERE type = 'abha';

-- down
DROP INDEX IF EXISTS clinical.one_abha_identifier_per_patient;
