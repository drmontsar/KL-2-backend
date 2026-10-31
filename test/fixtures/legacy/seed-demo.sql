BEGIN;

DO $seed$
DECLARE
  doc uuid := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  consultant uuid := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
  incoming_doctor uuid := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';
  incoming_nurse uuid := 'd0100000-0000-4000-8000-000000000001';
  nurse uuid := 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  admin_user uuid := 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
  patient_a uuid := 'd1000000-0000-4000-8000-000000000001';
  patient_b uuid := 'd1000000-0000-4000-8000-000000000002';
  patient_c uuid := 'd1000000-0000-4000-8000-000000000003';
  patient_d uuid := 'd1000000-0000-4000-8000-000000000004';
  admission_a uuid := 'd2000000-0000-4000-8000-000000000001';
  admission_b uuid := 'd2000000-0000-4000-8000-000000000002';
  bed_a uuid := 'd3000000-0000-4000-8000-000000000001';
  bed_b uuid := 'd3000000-0000-4000-8000-000000000002';
  med_order uuid := 'd4000000-0000-4000-8000-000000000001';
  med_schedule uuid := 'd5000000-0000-4000-8000-000000000001';
  assessment uuid := 'd6000000-0000-4000-8000-000000000001';
  coverage uuid := 'd7000000-0000-4000-8000-000000000001';
  claim uuid := 'd8000000-0000-4000-8000-000000000001';
  discharge_plan uuid := 'd9000000-0000-4000-8000-000000000001';
  opd_waiting uuid := 'da000000-0000-4000-8000-000000000001';
  opd_seen uuid := 'da000000-0000-4000-8000-000000000002';
  form_instance uuid := 'db000000-0000-4000-8000-000000000001';
  form_version uuid := 'dc000000-0000-4000-8000-000000000001';
  ipass_session uuid := 'd0200000-0000-4000-8000-000000000001';
  bedside_session uuid := 'd0300000-0000-4000-8000-000000000001';
  icu_room uuid;
  ward_room uuid;
  v_unit_id uuid;
  medication_id uuid;
  medication_name text;
  template_id uuid;
  template_version_id uuid;
  template_fields jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('klinik:synthetic-demo-seed', 0));
  IF current_database() <> 'klinik' OR current_user <> 'klinik' THEN
    RAISE EXCEPTION 'Demo seed must run only in the KL-2 klinik database as the klinik user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff.users WHERE id = doc AND role = 'doctor' AND disabled_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM staff.users WHERE id = consultant AND job_role = 'consultant' AND disabled_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM staff.users WHERE id = incoming_doctor AND role = 'doctor' AND disabled_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM staff.users WHERE id = nurse AND role = 'nurse' AND disabled_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM staff.users WHERE id = admin_user AND job_role = 'administrator' AND disabled_at IS NULL) THEN
    RAISE EXCEPTION 'Expected KL-2 demo staff are missing or disabled; seed aborted without changes';
  END IF;
  IF EXISTS (
    SELECT 1 FROM clinical.patients p
    JOIN (VALUES (patient_a, '[DEMO] ICU Patient'), (patient_b, '[DEMO] Ward Patient'),
                 (patient_c, '[DEMO] OPD Waiting'), (patient_d, '[DEMO] OPD Follow-up')) expected(id, name)
      ON p.id = expected.id WHERE p.name <> expected.name
  ) OR EXISTS (
    SELECT 1 FROM clinical.admissions a
    JOIN (VALUES (admission_a, patient_a), (admission_b, patient_b)) expected(id, patient_id)
      ON a.id = expected.id WHERE a.patient_id <> expected.patient_id
  ) OR EXISTS (
    SELECT 1 FROM organization.beds b
    JOIN (VALUES (bed_a, '[DEMO]-ICU-1'), (bed_b, '[DEMO]-WARD-1')) expected(id, label)
      ON b.id = expected.id WHERE b.label <> expected.label
  ) OR EXISTS (SELECT 1 FROM staff.users WHERE id = incoming_nurse AND (name <> '[DEMO] Receiving Nurse' OR role <> 'nurse'))
    OR EXISTS (SELECT 1 FROM clinical.ipass_sessions WHERE id = ipass_session AND (outgoing_doctor_id <> doc OR incoming_doctor_id <> incoming_doctor))
    OR EXISTS (SELECT 1 FROM clinical.ipass_items WHERE id = 'd0210000-0000-4000-8000-000000000001' AND (session_id <> ipass_session OR admission_id <> admission_a))
    OR EXISTS (SELECT 1 FROM clinical.nurse_handover_sessions WHERE id = bedside_session AND (outgoing_nurse_id <> nurse OR incoming_nurse_id <> incoming_nurse))
    OR EXISTS (SELECT 1 FROM clinical.nurse_handover_items WHERE id = 'd0310000-0000-4000-8000-000000000001' AND (session_id <> bedside_session OR admission_id <> admission_b))
    OR EXISTS (SELECT 1 FROM clinical.orders WHERE id = med_order AND admission_id <> admission_a)
    OR EXISTS (SELECT 1 FROM clinical.medication_schedules WHERE id = med_schedule AND order_id <> med_order)
    OR EXISTS (SELECT 1 FROM finance.claims WHERE id = claim AND admission_id <> admission_b)
    OR EXISTS (SELECT 1 FROM forms.instances WHERE id = form_instance AND patient_id <> patient_b) THEN
    RAISE EXCEPTION 'A reserved demo ID is occupied by another record; seed aborted without changes';
  END IF;
  SELECT r.id, w.unit_id INTO STRICT icu_room, v_unit_id
    FROM organization.rooms r JOIN organization.wards w ON w.id = r.ward_id
    JOIN organization.units u ON u.id = w.unit_id JOIN organization.departments d ON d.id = u.department_id
    JOIN organization.facilities f ON f.id = d.facility_id
    WHERE f.code = 'DEFAULT' AND u.code = 'INPATIENT' AND w.name = 'ICU' AND r.name = 'Default';
  SELECT r.id INTO STRICT ward_room FROM organization.rooms r JOIN organization.wards w ON w.id = r.ward_id
    WHERE w.unit_id = v_unit_id AND w.name = 'General Medicine' AND r.name = 'Default';
  SELECT id, brand INTO STRICT medication_id, medication_name FROM clinical.medication_catalog WHERE code = 'DEMO-001' AND synthetic;
  SELECT t.id, v.id, v.fields INTO STRICT template_id, template_version_id, template_fields
    FROM forms.templates t JOIN forms.template_versions v ON v.template_id = t.id
    WHERE t.name = '[DEMO] General consent for admission and treatment' AND v.version = 1 AND v.synthetic;

  INSERT INTO staff.users (id, name, role, job_role, phone) VALUES
    (incoming_nurse, '[DEMO] Receiving Nurse', 'nurse', 'staff_nurse', '+44 7700 909666')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO staff.unit_memberships (user_id, unit_id) VALUES (incoming_nurse, v_unit_id)
    ON CONFLICT (user_id, unit_id) DO NOTHING;

  INSERT INTO clinical.patients (id, name, dob, sex, blood_group, phone, address, allergies, created_by) VALUES
    (patient_a, '[DEMO] ICU Patient', '1980-01-01', 'female', 'O+', '+00 DEMO 001', '[DEMO] Synthetic address', '[{"allergen":"demo-beta-allergy","reaction":"demo reaction","severity":"moderate"}]'::jsonb, doc),
    (patient_b, '[DEMO] Ward Patient', '1975-02-02', 'male', 'A+', '+00 DEMO 002', '[DEMO] Synthetic address', '[]'::jsonb, doc),
    (patient_c, '[DEMO] OPD Waiting', '1995-03-03', 'female', NULL, '+00 DEMO 003', '[DEMO] Synthetic address', '[]'::jsonb, doc),
    (patient_d, '[DEMO] OPD Follow-up', '1990-04-04', 'male', NULL, '+00 DEMO 004', '[DEMO] Synthetic address', '[]'::jsonb, doc)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.patient_identifiers (patient_id, type, value, issuer)
    SELECT id, 'uhid', uhid, 'KliniK demo' FROM clinical.patients WHERE id IN (patient_a, patient_b, patient_c, patient_d)
    ON CONFLICT (type, value) DO NOTHING;
  INSERT INTO clinical.patient_contacts (id, patient_id, type, label, value, is_primary)
    SELECT CASE id WHEN patient_a THEN 'dd000000-0000-4000-8000-000000000001'::uuid WHEN patient_b THEN 'dd000000-0000-4000-8000-000000000002'::uuid WHEN patient_c THEN 'dd000000-0000-4000-8000-000000000003'::uuid ELSE 'dd000000-0000-4000-8000-000000000004'::uuid END,
      id, 'phone', '[DEMO] Primary', phone, true FROM clinical.patients WHERE id IN (patient_a, patient_b, patient_c, patient_d)
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization.beds (id, room_id, label) VALUES (bed_a, icu_room, '[DEMO]-ICU-1'), (bed_b, ward_room, '[DEMO]-WARD-1') ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.admissions (id, patient_id, ward, bed, bed_id, unit_id, severity, assigned_doctor_id, assigned_to, created_by)
  VALUES (admission_a, patient_a, 'ICU', '[DEMO]-ICU-1', bed_a, v_unit_id, 'unstable', doc, nurse, doc),
         (admission_b, patient_b, 'General Medicine', '[DEMO]-WARD-1', bed_b, v_unit_id, 'stable', consultant, nurse, doc)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.bed_assignments (id, admission_id, bed_id, assigned_by) VALUES
    ('de000000-0000-4000-8000-000000000001', admission_a, bed_a, admin_user),
    ('de000000-0000-4000-8000-000000000002', admission_b, bed_b, admin_user) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.staff_assignments (id, admission_id, user_id, assignment_type, assigned_by) VALUES
    ('df000000-0000-4000-8000-000000000001', admission_a, doc, 'duty_doctor', admin_user),
    ('df000000-0000-4000-8000-000000000002', admission_a, consultant, 'treating_consultant', admin_user),
    ('df000000-0000-4000-8000-000000000003', admission_a, nurse, 'primary_nurse', admin_user),
    ('df000000-0000-4000-8000-000000000004', admission_b, consultant, 'treating_consultant', admin_user),
    ('df000000-0000-4000-8000-000000000005', admission_b, consultant, 'duty_doctor', admin_user),
    ('df000000-0000-4000-8000-000000000006', admission_b, nurse, 'primary_nurse', admin_user)
  ON CONFLICT DO NOTHING;
  INSERT INTO clinical.diagnoses (id, patient_id, admission_id, description, created_by) VALUES
    ('e0000000-0000-4000-8000-000000000001', patient_a, admission_a, '[DEMO] Synthetic critical-care diagnosis', doc),
    ('e0000000-0000-4000-8000-000000000002', patient_b, admission_b, '[DEMO] Synthetic ward diagnosis', doc) ON CONFLICT (id) DO NOTHING;

  INSERT INTO clinical.vitals (id, admission_id, recorded_by, bp_systolic, bp_diastolic, heart_rate, spo2, resp_rate, temperature, on_supplemental_oxygen, consciousness, news2_score, news2_escalation, news2_component_scores, news2_rule_version) VALUES
    ('e1000000-0000-4000-8000-000000000001', admission_a, nurse, 95, 60, 110, 90, 24, 38.0, true, 'alert', 10, 'high', '{"resp_rate":2,"spo2":3,"supplemental_oxygen":2,"temperature":0,"bp_systolic":2,"heart_rate":1,"consciousness":0}'::jsonb, 'NEWS2-2017-scale-1'),
    ('e1000000-0000-4000-8000-000000000002', admission_b, nurse, 120, 80, 75, 98, 16, 37.0, false, 'alert', 0, 'low', '{"resp_rate":0,"spo2":0,"supplemental_oxygen":0,"temperature":0,"bp_systolic":0,"heart_rate":0,"consciousness":0}'::jsonb, 'NEWS2-2017-scale-1')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.observation_schedules (admission_id, frequency_minutes, next_due_at, source, policy_version, updated_by) VALUES
    (admission_a, 15, now() - interval '5 minutes', 'news2_policy', 'NEWS2-2017-scale-1', nurse),
    (admission_b, 720, now() + interval '4 hours', 'news2_policy', 'NEWS2-2017-scale-1', nurse) ON CONFLICT (admission_id) DO NOTHING;
  INSERT INTO clinical.alerts (id, admission_id, source_vitals_id, type, severity, message) VALUES
    ('e2000000-0000-4000-8000-000000000001', admission_a, 'e1000000-0000-4000-8000-000000000001', 'news2', 'warning', '[DEMO] NEWS2 10: emergency response; continuous monitoring') ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.notes (id, admission_id, kind, draft_body, created_by) VALUES
    ('e3000000-0000-4000-8000-000000000001', admission_a, 'progress', '[DEMO] Synthetic assessment and monitoring plan.', doc) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.note_versions (id, note_id, version_no, body, confirmed_by) VALUES
    ('e4000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 1, '[DEMO] Synthetic assessment and monitoring plan.', doc) ON CONFLICT (id) DO NOTHING;

  INSERT INTO clinical.nursing_assessments (id, admission_id, assessed_by, arrival_source, transport_mode, identity_verified, allergy_verified, language, belongings, dependence, skin, vulnerabilities, devices, pain_score, pain_site, morse, morse_score, braden, braden_score, must, must_score, care_plan, reassess_by)
  VALUES (assessment, admission_a, nurse, '[DEMO] Emergency', 'Stretcher', true, true, 'English', '[DEMO] Recorded', 'Fully dependent', '[DEMO] Intact', '[]'::jsonb,
    '[{"type":"Urinary catheter","site":"urinary","inserted_at":"2026-01-01"}]'::jsonb, 4, '[DEMO]',
    '{"history":25,"secondary":15,"aid":0,"iv":20,"gait":10,"mental":0}'::jsonb, 70,
    '{"sensory":2,"moisture":2,"activity":1,"mobility":1,"nutrition":2,"friction":1}'::jsonb, 9,
    '{"bmi":1,"weight_loss":1,"acute":0}'::jsonb, 2,
    '["[DEMO] Fall precautions","[DEMO] Pressure-area care","[DEMO] Dietitian review"]'::jsonb, now() + interval '24 hours') ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.nursing_recurring_tasks (id, admission_id, source_assessment_id, description, interval_minutes, due_at, created_by) VALUES
    ('e5000000-0000-4000-8000-000000000001', admission_a, assessment, '[DEMO] Position and pressure-area check', 120, now() - interval '15 minutes', nurse) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.patient_weights (id, admission_id, weight_kg, measured_at, recorded_by) VALUES
    ('e6000000-0000-4000-8000-000000000001', admission_a, 60, now() - interval '2 hours', nurse) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.fluid_entries (id, admission_id, recorded_by, direction, category, volume_ml, occurred_at) VALUES
    ('e7000000-0000-4000-8000-000000000001', admission_a, nurse, 'output', 'urine', 20, date_trunc('hour', now()) - interval '30 minutes'),
    ('e7000000-0000-4000-8000-000000000002', admission_a, nurse, 'output', 'urine', 15, date_trunc('hour', now()) - interval '90 minutes'),
    ('e7000000-0000-4000-8000-000000000003', admission_a, nurse, 'intake', 'IV fluid', 250, now() - interval '30 minutes') ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.alerts (id, admission_id, type, severity, message) VALUES
    ('e2000000-0000-4000-8000-000000000002', admission_a, 'low_urine_output', 'warning', '[DEMO] Low urine output for two hours') ON CONFLICT DO NOTHING;

  INSERT INTO clinical.orders (id, admission_id, kind, payload, status, priority, created_by, confirmed_by, confirmed_at)
  VALUES (med_order, admission_a, 'medication', jsonb_build_object('drug', medication_name, 'dose', '1 demo unit', 'route', 'oral', 'catalog_id', medication_id), 'confirmed', 'routine', doc, doc, now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.tasks (id, order_id, admission_id, due_at) VALUES
    ('e8000000-0000-4000-8000-000000000001', med_order, admission_a, now() + interval '30 minutes') ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.medication_schedules (id, admission_id, order_id, drug, dose, route, catalog_id, created_by)
  VALUES (med_schedule, admission_a, med_order, medication_name, '1 demo unit', 'oral', medication_id, doc) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.medication_allergy_reviews (id, schedule_id, patient_revision, decision, reason, reviewed_by)
  SELECT 'e9000000-0000-4000-8000-000000000001', med_schedule, revision, 'safe', '[DEMO] Synthetic review; not a clinical decision', doc FROM clinical.patients WHERE id = patient_a ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.medication_doses (id, schedule_id, due_at) VALUES
    ('ea000000-0000-4000-8000-000000000001', med_schedule, now() + interval '15 minutes') ON CONFLICT (id) DO NOTHING;

  INSERT INTO clinical.patient_coverage (id, patient_id, payer_name, policy_number, is_primary)
  VALUES (coverage, patient_b, '[DEMO] Synthetic insurer', 'DEMO-POLICY-001', true) ON CONFLICT (id) DO NOTHING;
  INSERT INTO finance.claims (id, admission_id, coverage_id, status, currency, approved_limit, current_usage, estimate, created_by)
  VALUES (claim, admission_b, coverage, 'query_raised', 'INR', 15000.00, 6000.00, 11000.00, admin_user) ON CONFLICT (id) DO NOTHING;
  INSERT INTO finance.claim_queries (id, claim_id, question, raised_by) VALUES
    ('eb000000-0000-4000-8000-000000000001', claim, '[DEMO] Please provide the admission note.', admin_user) ON CONFLICT (id) DO NOTHING;
  INSERT INTO finance.claim_events (id, claim_id, type, note, actor_id) VALUES
    ('ec000000-0000-4000-8000-000000000001', claim, 'raise_query', '[DEMO] Synthetic insurer query', admin_user) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.discharge_plans (id, admission_id, discharge_type, planned_at, condition, follow_up, requested_by)
  VALUES (discharge_plan, admission_b, 'home', now() + interval '1 day', '[DEMO] Stable', '[DEMO] Follow-up in one week', doc) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.discharge_tasks (plan_id, code)
    SELECT discharge_plan, code FROM unnest(ARRAY['summary','pending_results','medication_reconciliation','nursing','billing','insurance','payment']) AS code ON CONFLICT (plan_id, code) DO NOTHING;
  INSERT INTO clinical.cross_referrals (id, admission_id, requested_by, consultant_id, specialty, urgency, question, findings) VALUES
    ('ed000000-0000-4000-8000-000000000001', admission_a, doc, consultant, '[DEMO] Cardiology', 'urgent', '[DEMO] Please review.', '[DEMO] Synthetic findings.') ON CONFLICT (id) DO NOTHING;

  INSERT INTO opd.visits (id, patient_id, chief_complaints, patient_notes, created_by) VALUES
    (opd_waiting, patient_c, '["[DEMO] Synthetic complaint"]'::jsonb, '[DEMO] Waiting visit', doc) ON CONFLICT (id) DO NOTHING;
  INSERT INTO opd.visits (id, patient_id, status, chief_complaints, consultation_note, follow_up, created_by, signed_by, signed_at) VALUES
    (opd_seen, patient_d, 'seen', '["[DEMO] Follow-up"]'::jsonb, '[DEMO] Synthetic consultation.', '1 week', doc, doc, now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO opd.visit_diagnoses (id, visit_id, code) VALUES
    ('ee000000-0000-4000-8000-000000000001', opd_seen, 'DEMO-DX-001') ON CONFLICT (id) DO NOTHING;
  INSERT INTO opd.visit_investigations (id, visit_id, code) VALUES
    ('ee000000-0000-4000-8000-000000000002', opd_seen, 'DEMO-LAB-001') ON CONFLICT (id) DO NOTHING;
  INSERT INTO opd.prescriptions (id, visit_id, medication_id, dose, route, frequency, duration, created_by) VALUES
    ('ee000000-0000-4000-8000-000000000003', opd_seen, medication_id, '1 demo unit', 'oral', 'daily', '3 days', doc) ON CONFLICT (id) DO NOTHING;
  INSERT INTO opd.visit_charges (visit_id, consultation_amount, investigation_amount, total_amount, currency) VALUES
    (opd_seen, 600.00, 300.00, 900.00, 'INR') ON CONFLICT (visit_id) DO NOTHING;
  INSERT INTO opd.dispatches (id, visit_id, kind) VALUES
    ('ee000000-0000-4000-8000-000000000004', opd_seen, 'pharmacy'),
    ('ee000000-0000-4000-8000-000000000005', opd_seen, 'collection') ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.admission_requests (id, patient_id, source, diagnosis, clinical_handover, requested_unit_id, requested_by, opd_visit_id) VALUES
    ('ef000000-0000-4000-8000-000000000001', patient_d, 'opd', '[DEMO] Synthetic admission diagnosis', '[DEMO] Synthetic OPD handover', v_unit_id, doc, opd_seen) ON CONFLICT (id) DO NOTHING;

  INSERT INTO forms.instances (id, patient_id, admission_id, template_id, created_by) VALUES
    (form_instance, patient_b, admission_b, template_id, doc) ON CONFLICT (id) DO NOTHING;
  INSERT INTO forms.instance_versions (id, instance_id, template_version_id, version, fields, form_values, source_snapshot, created_by)
  SELECT form_version, form_instance, template_version_id, 1, template_fields,
    jsonb_build_object('patient_name', name, 'uhid', uhid, 'details', '[DEMO] Synthetic form; not a consent document'),
    jsonb_build_object('patient_name', jsonb_build_object('source', 'name', 'value', name), 'uhid', jsonb_build_object('source', 'uhid', 'value', uhid)), doc
    FROM clinical.patients WHERE id = patient_b ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM clinical.ipass_sessions WHERE id = ipass_session) AND NOT EXISTS (
    SELECT 1 FROM clinical.admissions WHERE id = admission_a AND status = 'active' AND assigned_doctor_id = doc
  ) THEN
    RAISE EXCEPTION 'Demo I-PASS patient is no longer assigned to the demo outgoing doctor; existing state preserved';
  END IF;
  INSERT INTO clinical.ipass_sessions (id, outgoing_doctor_id, incoming_doctor_id, status, sent_at)
  VALUES (ipass_session, doc, incoming_doctor, 'sent', now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.ipass_items (id, session_id, admission_id, patient_name, ward, bed, severity, patient_summary, action_list, contingency, status, snapshot_revision, signed_at)
  SELECT 'd0210000-0000-4000-8000-000000000001', ipass_session, a.id, p.name, a.ward, a.bed, a.severity,
    '[DEMO] Synthetic ICU patient summary.', '[DEMO] Continue synthetic monitoring.', '[DEMO] Escalate synthetic deterioration.', 'signed', a.revision, now()
  FROM clinical.admissions a JOIN clinical.patients p ON p.id = a.patient_id WHERE a.id = admission_a
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.ipass_questions (id, item_id, author_id, body) VALUES
    ('d0220000-0000-4000-8000-000000000001', 'd0210000-0000-4000-8000-000000000001', incoming_doctor, '[DEMO] What is the next monitoring action?') ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM clinical.nurse_handover_sessions WHERE id = bedside_session) AND NOT EXISTS (
    SELECT 1 FROM clinical.admissions WHERE id = admission_b AND status = 'active' AND assigned_to = nurse
  ) THEN
    RAISE EXCEPTION 'Demo bedside patient is no longer assigned to the demo outgoing nurse; existing state preserved';
  END IF;
  INSERT INTO clinical.nurse_handover_sessions (id, outgoing_nurse_id, incoming_nurse_id, status, sent_at)
  VALUES (bedside_session, nurse, incoming_nurse, 'sent', now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.nurse_handover_items (id, session_id, admission_id, patient_name, ward, bed, snapshot, handover_notes)
  SELECT 'd0310000-0000-4000-8000-000000000001', bedside_session, a.id, p.name, a.ward, a.bed,
    jsonb_build_object('severity', a.severity, 'allergies', p.allergies,
      'latest_observation', (SELECT to_jsonb(v) FROM clinical.vitals v WHERE v.admission_id = a.id ORDER BY v.recorded_at DESC, v.event_order DESC LIMIT 1),
      'latest_assessment', null, 'open_orders', '[]'::jsonb, 'medications', '[]'::jsonb,
      'infusions', '[]'::jsonb, 'nursing_tasks', '[]'::jsonb, 'fluid_balance', 0),
    '[DEMO] Synthetic bedside handover notes.'
  FROM clinical.admissions a JOIN clinical.patients p ON p.id = a.patient_id WHERE a.id = admission_b
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO clinical.nurse_handover_questions (id, item_id, author_id, body) VALUES
    ('d0320000-0000-4000-8000-000000000001', 'd0310000-0000-4000-8000-000000000001', incoming_nurse, '[DEMO] Any bedside concerns?') ON CONFLICT (id) DO NOTHING;

  INSERT INTO clinical.notifications (id, user_id, type, payload) VALUES
    ('f0000000-0000-4000-8000-000000000004', incoming_doctor, 'ipass.sent', jsonb_build_object('session_id', ipass_session, 'demo', true)),
    ('f0000000-0000-4000-8000-000000000005', incoming_nurse, 'nurse_handover.sent', jsonb_build_object('session_id', bedside_session, 'demo', true)),
    ('f0000000-0000-4000-8000-000000000001', doc, 'demo.claim_query', jsonb_build_object('claim_id', claim, 'demo', true)),
    ('f0000000-0000-4000-8000-000000000002', consultant, 'demo.referral', jsonb_build_object('admission_id', admission_a, 'demo', true)),
    ('f0000000-0000-4000-8000-000000000003', nurse, 'demo.medication_due', jsonb_build_object('admission_id', admission_a, 'demo', true)) ON CONFLICT (id) DO NOTHING;
END
$seed$;

COMMIT;
