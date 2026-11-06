-- up
-- Existing named-recipient sessions remain readable; new sessions are shared.
ALTER TABLE clinical.ipass_sessions ALTER COLUMN incoming_doctor_id DROP NOT NULL;
ALTER TABLE clinical.ipass_sessions ADD COLUMN ward text;
ALTER TABLE clinical.ipass_items ADD COLUMN reviewed_by uuid REFERENCES staff.users(id);
ALTER TABLE clinical.ipass_items ADD COLUMN receiver_view text;
ALTER TABLE clinical.ipass_items ADD COLUMN stale_acknowledged boolean NOT NULL DEFAULT false;
UPDATE clinical.ipass_items i
SET reviewed_by = s.incoming_doctor_id, receiver_view = NULLIF(btrim(i.readback), '')
FROM clinical.ipass_sessions s
WHERE i.session_id = s.id AND i.status = 'accepted' AND s.incoming_doctor_id IS NOT NULL;

-- down
-- A shared handover cannot be assigned back to one arbitrary doctor.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM clinical.ipass_sessions WHERE incoming_doctor_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot revert shared doctor handovers while shared sessions exist';
  END IF;
END $$;
ALTER TABLE clinical.ipass_items DROP COLUMN stale_acknowledged;
ALTER TABLE clinical.ipass_items DROP COLUMN receiver_view;
ALTER TABLE clinical.ipass_items DROP COLUMN reviewed_by;
ALTER TABLE clinical.ipass_sessions DROP COLUMN ward;
ALTER TABLE clinical.ipass_sessions ALTER COLUMN incoming_doctor_id SET NOT NULL;
