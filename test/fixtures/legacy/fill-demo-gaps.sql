BEGIN;

DO $fill$
DECLARE
  fixture_user uuid := 'd0400000-0000-4000-8000-000000000001';
  patient_record record;
  admission_record record;
  observation_id uuid;
  note_id uuid;
  phone_value text;
  address_value text;
  observations_added integer := 0;
  profiles_updated integer := 0;
  kin_added integer := 0;
  notes_added integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('klinik:synthetic-gap-fill', 0));
  IF current_database() <> 'klinik' OR current_user <> 'klinik' THEN
    RAISE EXCEPTION 'Demo gap fill must run only in the KL-2 klinik database as the klinik user';
  END IF;
  IF EXISTS (SELECT 1 FROM staff.users WHERE id = fixture_user AND (name <> '[DEMO] Synthetic Data Generator' OR role <> 'nurse' OR disabled_at IS NULL)) THEN
    RAISE EXCEPTION 'Synthetic generator ID is occupied by another user; no changes made';
  END IF;

  INSERT INTO staff.users (id, name, role, job_role, phone, registration_number, specialization, disabled_at)
  VALUES (fixture_user, '[DEMO] Synthetic Data Generator', 'nurse', 'staff_nurse', '+00 DEMO FIXTURE 900001',
          'DEMO-REG-SYNTHETIC-FIXTURE', '[DEMO] Synthetic data only', now())
  ON CONFLICT (id) DO NOTHING;

  FOR patient_record IN SELECT * FROM clinical.patients ORDER BY id FOR UPDATE LOOP
    SELECT COALESCE(NULLIF(btrim(patient_record.phone), ''),
      (SELECT value FROM clinical.patient_contacts WHERE patient_id = patient_record.id AND type = 'phone' AND is_primary LIMIT 1),
      '[DEMO] phone ' || left(patient_record.id::text, 8)) INTO phone_value;
    SELECT COALESCE(NULLIF(btrim(patient_record.address), ''),
      (SELECT value FROM clinical.patient_contacts WHERE patient_id = patient_record.id AND type = 'address' AND is_primary LIMIT 1),
      '[DEMO] address ' || left(patient_record.id::text, 8)) INTO address_value;

    IF patient_record.phone IS NULL OR btrim(patient_record.phone) = '' OR patient_record.address IS NULL OR btrim(patient_record.address) = '' OR patient_record.sex IS NULL THEN
      UPDATE clinical.patients SET
        phone = CASE WHEN phone IS NULL OR btrim(phone) = '' THEN phone_value ELSE phone END,
        address = CASE WHEN address IS NULL OR btrim(address) = '' THEN address_value ELSE address END,
        sex = COALESCE(sex, 'unknown'),
        revision = revision + 1
      WHERE id = patient_record.id;
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, before, after)
      SELECT fixture_user, 'synthetic_profile_fill', 'clinical.patients', id,
        jsonb_build_object('phone', patient_record.phone, 'address', patient_record.address, 'sex', patient_record.sex),
        jsonb_build_object('phone', phone, 'address', address, 'sex', sex, 'synthetic', true)
      FROM clinical.patients WHERE id = patient_record.id;
      profiles_updated := profiles_updated + 1;
    END IF;

    INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
    SELECT patient_record.id, 'phone', '[DEMO] Primary', phone_value, true
    WHERE NOT EXISTS (SELECT 1 FROM clinical.patient_contacts WHERE patient_id = patient_record.id AND type = 'phone' AND is_primary)
    ON CONFLICT (patient_id, type) WHERE is_primary DO NOTHING;
    INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
    SELECT patient_record.id, 'address', '[DEMO] Home', address_value, true
    WHERE NOT EXISTS (SELECT 1 FROM clinical.patient_contacts WHERE patient_id = patient_record.id AND type = 'address' AND is_primary)
    ON CONFLICT (patient_id, type) WHERE is_primary DO NOTHING;

    IF NOT EXISTS (SELECT 1 FROM clinical.next_of_kin WHERE patient_id = patient_record.id) THEN
      INSERT INTO clinical.next_of_kin (patient_id, name, relationship, phone, is_primary)
      VALUES (patient_record.id, '[DEMO] Emergency contact', '[DEMO] Other', '[DEMO] contact ' || left(patient_record.id::text, 8), true);
      kin_added := kin_added + 1;
    END IF;
  END LOOP;

  FOR admission_record IN SELECT id, severity FROM clinical.admissions WHERE status = 'active' ORDER BY id FOR UPDATE LOOP
    IF NOT EXISTS (SELECT 1 FROM clinical.vitals WHERE admission_id = admission_record.id AND news2_score IS NOT NULL) THEN
      INSERT INTO clinical.vitals
        (admission_id, recorded_by, recorded_at, bp_systolic, bp_diastolic, heart_rate, spo2, resp_rate, temperature,
         on_supplemental_oxygen, consciousness, news2_score, news2_escalation, news2_component_scores, news2_rule_version)
      VALUES
        (admission_record.id, fixture_user, clock_timestamp(),
         CASE WHEN admission_record.severity = 'unstable' THEN 95 ELSE 120 END,
         CASE WHEN admission_record.severity = 'unstable' THEN 60 ELSE 80 END,
         CASE WHEN admission_record.severity = 'unstable' THEN 110 ELSE 75 END,
         CASE WHEN admission_record.severity = 'unstable' THEN 90 ELSE 98 END,
         CASE WHEN admission_record.severity = 'unstable' THEN 24 WHEN admission_record.severity = 'watcher' THEN 8 ELSE 16 END,
         CASE WHEN admission_record.severity = 'unstable' THEN 38.0 ELSE 37.0 END,
         admission_record.severity = 'unstable', 'alert',
         CASE WHEN admission_record.severity = 'unstable' THEN 10 WHEN admission_record.severity = 'watcher' THEN 3 ELSE 0 END,
         CASE WHEN admission_record.severity = 'unstable' THEN 'high' WHEN admission_record.severity = 'watcher' THEN 'low-medium' ELSE 'low' END,
         jsonb_build_object('resp_rate', CASE WHEN admission_record.severity = 'unstable' THEN 2 WHEN admission_record.severity = 'watcher' THEN 3 ELSE 0 END,
           'spo2', CASE WHEN admission_record.severity = 'unstable' THEN 3 ELSE 0 END,
           'supplemental_oxygen', CASE WHEN admission_record.severity = 'unstable' THEN 2 ELSE 0 END,
           'temperature', 0, 'bp_systolic', CASE WHEN admission_record.severity = 'unstable' THEN 2 ELSE 0 END,
           'heart_rate', CASE WHEN admission_record.severity = 'unstable' THEN 1 ELSE 0 END, 'consciousness', 0),
         '[DEMO] NEWS2-2017-scale-1') RETURNING id INTO observation_id;
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (fixture_user, 'synthetic_observation_fill', 'clinical.vitals', observation_id,
              jsonb_build_object('admission_id', admission_record.id, 'synthetic', true));
      INSERT INTO clinical.observation_schedules (admission_id, frequency_minutes, next_due_at, source, policy_version, updated_by)
      VALUES (admission_record.id,
        CASE WHEN admission_record.severity = 'unstable' THEN 15 WHEN admission_record.severity = 'watcher' THEN 60 ELSE 720 END,
        now() + make_interval(mins => CASE WHEN admission_record.severity = 'unstable' THEN 15 WHEN admission_record.severity = 'watcher' THEN 60 ELSE 720 END),
        'news2_policy', '[DEMO] NEWS2-2017-scale-1', fixture_user)
      ON CONFLICT (admission_id) DO NOTHING;
      IF admission_record.severity IN ('unstable', 'watcher') AND NOT EXISTS (
        SELECT 1 FROM clinical.alerts WHERE admission_id = admission_record.id AND type = 'news2' AND status IN ('active', 'acknowledged')
      ) THEN
        INSERT INTO clinical.alerts (admission_id, source_vitals_id, type, severity, message)
        VALUES (admission_record.id, observation_id, 'news2',
          CASE WHEN admission_record.severity = 'unstable' THEN 'warning' ELSE 'caution' END,
          '[DEMO] Synthetic NEWS2 escalation for frontend testing; not clinical data');
      END IF;
      observations_added := observations_added + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM clinical.notes WHERE admission_id = admission_record.id) THEN
      INSERT INTO clinical.notes (admission_id, kind, draft_body, created_by)
      VALUES (admission_record.id, 'progress', '[DEMO] Synthetic placeholder note for frontend testing. Not a clinical assessment.', fixture_user)
      RETURNING id INTO note_id;
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (fixture_user, 'synthetic_note_fill', 'clinical.notes', note_id,
              jsonb_build_object('admission_id', admission_record.id, 'synthetic', true));
      notes_added := notes_added + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Synthetic gap fill: % NEWS2 observations, % patient profiles, % emergency contacts, % draft notes',
    observations_added, profiles_updated, kin_added, notes_added;
END
$fill$;

COMMIT;
