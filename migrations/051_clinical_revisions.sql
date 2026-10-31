-- up
-- A handover revision must change for clinical content, not only admission metadata.
CREATE FUNCTION clinical.touch_admission_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  record_data jsonb;
  admission uuid;
BEGIN
  record_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME = 'note_versions' THEN
    SELECT admission_id INTO admission FROM clinical.notes WHERE id = (record_data->>'note_id')::uuid;
  ELSIF TG_TABLE_NAME = 'amendments' THEN
    SELECT n.admission_id INTO admission FROM clinical.notes n
    JOIN clinical.note_versions v ON v.note_id = n.id WHERE v.id = (record_data->>'note_version_id')::uuid;
  ELSE
    admission := (record_data->>'admission_id')::uuid;
  END IF;
  UPDATE clinical.admissions SET revision = revision + 1 WHERE id = admission;
  RETURN NULL;
END;
$$;

CREATE TRIGGER admission_revision AFTER INSERT OR UPDATE OR DELETE ON clinical.notes FOR EACH ROW EXECUTE FUNCTION clinical.touch_admission_revision();
CREATE TRIGGER admission_revision AFTER INSERT OR UPDATE OR DELETE ON clinical.note_versions FOR EACH ROW EXECUTE FUNCTION clinical.touch_admission_revision();
CREATE TRIGGER admission_revision AFTER INSERT OR UPDATE OR DELETE ON clinical.amendments FOR EACH ROW EXECUTE FUNCTION clinical.touch_admission_revision();
CREATE TRIGGER admission_revision AFTER INSERT OR UPDATE OR DELETE ON clinical.orders FOR EACH ROW EXECUTE FUNCTION clinical.touch_admission_revision();
CREATE TRIGGER admission_revision AFTER INSERT OR UPDATE OR DELETE ON clinical.vitals FOR EACH ROW EXECUTE FUNCTION clinical.touch_admission_revision();
CREATE TRIGGER admission_revision AFTER INSERT OR UPDATE OR DELETE ON clinical.diagnoses FOR EACH ROW EXECUTE FUNCTION clinical.touch_admission_revision();
CREATE TRIGGER admission_revision AFTER INSERT OR UPDATE OR DELETE ON clinical.contingencies FOR EACH ROW EXECUTE FUNCTION clinical.touch_admission_revision();
CREATE TRIGGER admission_revision AFTER INSERT OR UPDATE OR DELETE ON clinical.shift_events FOR EACH ROW EXECUTE FUNCTION clinical.touch_admission_revision();

-- Invalidate snapshots taken before revision tracking covered clinical writes.
UPDATE clinical.admissions SET revision = revision + 1;

-- down
DROP TRIGGER admission_revision ON clinical.shift_events;
DROP TRIGGER admission_revision ON clinical.contingencies;
DROP TRIGGER admission_revision ON clinical.diagnoses;
DROP TRIGGER admission_revision ON clinical.vitals;
DROP TRIGGER admission_revision ON clinical.orders;
DROP TRIGGER admission_revision ON clinical.amendments;
DROP TRIGGER admission_revision ON clinical.note_versions;
DROP TRIGGER admission_revision ON clinical.notes;
DROP FUNCTION clinical.touch_admission_revision();
