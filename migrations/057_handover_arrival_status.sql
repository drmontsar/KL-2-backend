-- up
-- An incoming patient still needs shift handover; snapshot their arrival stage.
ALTER TABLE clinical.ipass_items ADD COLUMN arrival_status text NOT NULL DEFAULT 'admitted'
  CHECK (arrival_status IN ('incoming', 'admitted'));
UPDATE clinical.ipass_items i SET arrival_status = a.arrival_status
FROM clinical.admissions a WHERE a.id = i.admission_id;

-- down
ALTER TABLE clinical.ipass_items DROP COLUMN arrival_status;
