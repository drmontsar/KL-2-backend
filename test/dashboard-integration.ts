import postgres from 'postgres';

const baseUrl = process.env.BASE_URL;
if (!baseUrl || !process.env.DATABASE_URL) throw new Error('BASE_URL and DATABASE_URL are required');
const sql = postgres(process.env.DATABASE_URL);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function login(phone: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, otp: 'demo' }),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  return (await response.json() as { token: string }).token;
}
async function get(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

const ids = await sql.begin(async (tx) => {
  const [department] = await tx<{ id: string }[]>`SELECT id FROM organization.departments ORDER BY id LIMIT 1`;
  const users = await tx<{ id: string; name: string }[]>`
    INSERT INTO staff.users (name, role, job_role, phone, specialization) VALUES
      ('Dashboard Doctor', 'doctor', 'duty_doctor', '+44 7700 902001', NULL),
      ('Dashboard Other Doctor', 'doctor', 'duty_doctor', '+44 7700 902002', NULL),
      ('Dashboard Outside Doctor', 'doctor', 'duty_doctor', '+44 7700 902003', NULL),
      ('Dashboard Nurse', 'nurse', 'staff_nurse', '+44 7700 902004', NULL),
      ('Dashboard Consultant', 'doctor', 'consultant', '+44 7700 902005', 'Cardiology') RETURNING id, name
  `;
  const userId = (name: string) => users.find((user) => user.name === name)!.id;
  const doctor = userId('Dashboard Doctor'); const other = userId('Dashboard Other Doctor');
  const outside = userId('Dashboard Outside Doctor'); const nurse = userId('Dashboard Nurse');
  const consultant = userId('Dashboard Consultant');
  const units = await tx<{ id: string; code: string }[]>`
    INSERT INTO organization.units (department_id, code, name) VALUES
      (${department.id}, 'DASH-1', 'Dashboard One'), (${department.id}, 'DASH-2', 'Dashboard Two'),
      (${department.id}, 'DASH-EMPTY', 'Dashboard Empty') RETURNING id, code
  `;
  const unit = units.find((item) => item.code === 'DASH-1')!.id;
  const outsideUnit = units.find((item) => item.code === 'DASH-2')!.id;
  const emptyUnit = units.find((item) => item.code === 'DASH-EMPTY')!.id;
  await tx`INSERT INTO staff.unit_memberships (user_id, unit_id) VALUES (${doctor}, ${unit}), (${nurse}, ${unit}), (${outside}, ${outsideUnit}), (${doctor}, ${emptyUnit})`;
  const patients = await tx<{ id: string; name: string; uhid: string }[]>`
    INSERT INTO clinical.patients (name, dob, sex, allergies, created_by) VALUES
      ('Dashboard Patient One', '1980-01-01', 'female', '[{"allergen":"Penicillin","severity":"severe"}]'::jsonb, ${doctor}),
      ('Dashboard Patient Two', '1985-02-02', 'male', '[]'::jsonb, ${other}),
      ('Dashboard Patient Outside', '1990-03-03', 'other', '[]'::jsonb, ${outside}) RETURNING id, name, uhid
  `;
  const patient = patients.find((row) => row.name === 'Dashboard Patient One')!;
  const patient2 = patients.find((row) => row.name === 'Dashboard Patient Two')!;
  const patient3 = patients.find((row) => row.name === 'Dashboard Patient Outside')!;
  const admissions = await tx<{ id: string; patient_id: string }[]>`
    INSERT INTO clinical.admissions (patient_id, unit_id, ward, bed, severity, assigned_doctor_id, assigned_to, created_by) VALUES
      (${patient.id}, ${unit}, 'Dashboard Ward', 'D-1', 'unstable', ${doctor}, ${nurse}, ${doctor}),
      (${patient2.id}, ${unit}, 'Dashboard Ward', 'D-2', 'watcher', ${other}, NULL, ${other}),
      (${patient3.id}, ${outsideUnit}, 'Outside Ward', 'O-1', 'unstable', ${outside}, NULL, ${outside}) RETURNING id, patient_id
  `;
  const admission = admissions.find((row) => row.patient_id === patient.id)!.id;
  const admission2 = admissions.find((row) => row.patient_id === patient2.id)!.id;
  const admission3 = admissions.find((row) => row.patient_id === patient3.id)!.id;
  await tx`
    INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by)
    VALUES (${admission}, ${consultant}, 'treating_consultant', ${doctor})
  `;
  await tx`
    INSERT INTO clinical.vitals (admission_id, recorded_by, recorded_at, news2_score, news2_escalation, news2_component_scores, news2_rule_version) VALUES
      (${admission}, ${nurse}, now() - interval '1 hour', 0, 'low', '{}'::jsonb, 'test'),
      (${admission}, ${nurse}, now(), 8, 'high', '{"heart_rate":3}'::jsonb, 'test'),
      (${admission2}, ${other}, now(), 3, 'low-medium', '{"heart_rate":3}'::jsonb, 'test'),
      (${admission3}, ${outside}, now(), 8, 'high', '{}'::jsonb, 'test')
  `;
  await tx`
    INSERT INTO clinical.orders (admission_id, kind, payload, priority, status, created_by, confirmed_by, confirmed_at, acknowledged_by, acknowledged_at) VALUES
      (${admission}, 'clinical', '{}'::jsonb, 'stat', 'confirmed', ${doctor}, ${doctor}, now(), NULL, NULL),
      (${admission}, 'clinical', '{}'::jsonb, 'routine', 'confirmed', ${doctor}, ${doctor}, now(), NULL, NULL),
      (${admission}, 'clinical', '{}'::jsonb, 'routine', 'confirmed', ${doctor}, ${doctor}, now(), ${nurse}, now()),
      (${admission}, 'clinical', '{}'::jsonb, 'stat', 'draft', ${doctor}, NULL, NULL, NULL, NULL),
      (${admission3}, 'clinical', '{}'::jsonb, 'stat', 'confirmed', ${outside}, ${outside}, now(), NULL, NULL)
  `;
  await tx`
    INSERT INTO clinical.alerts (admission_id, type, severity, message, status) VALUES
      (${admission}, 'news2', 'warning', 'Dashboard test warning', 'active'),
      (${admission}, 'low_urine_output', 'caution', 'Dashboard test caution', 'active')
  `;
  await tx`
    INSERT INTO clinical.patient_movements (admission_id, movement_type, destination_unit_id, reason, escort, requested_by)
    VALUES (${admission}, 'permanent', ${unit}, 'Dashboard test', 'nurse', ${doctor})
  `;
  const [session] = await tx<{ id: string }[]>`INSERT INTO clinical.ipass_sessions (outgoing_doctor_id, incoming_doctor_id) VALUES (${doctor}, ${other}) RETURNING id`;
  const [handover] = await tx<{ id: string }[]>`
    INSERT INTO clinical.ipass_items (session_id, admission_id, patient_name, severity, snapshot_revision)
    SELECT ${session.id}, id, ${patient.name}, severity, revision FROM clinical.admissions WHERE id = ${admission} RETURNING id
  `;
  const [coverage] = await tx<{ id: string }[]>`INSERT INTO clinical.patient_coverage (patient_id, payer_name, policy_number, is_primary) VALUES (${patient.id}, 'Dashboard Payer', 'DASH-POLICY-1', true) RETURNING id`;
  await tx`
    INSERT INTO finance.claims (admission_id, coverage_id, status, currency, approved_limit, current_usage, created_by)
    VALUES (${admission}, ${coverage.id}, 'query_raised', 'INR', 5000.00, 1234.50, ${doctor})
  `;
  await tx`
    INSERT INTO clinical.cross_referrals (admission_id, requested_by, consultant_id, specialty, urgency, question)
    VALUES (${admission}, ${doctor}, ${consultant}, 'Cardiology', 'routine', 'Dashboard test')
  `;
  const [discharge] = await tx<{ id: string }[]>`
    INSERT INTO clinical.discharge_plans (admission_id, discharge_type, planned_at, condition, follow_up, requested_by)
    VALUES (${admission}, 'home', now(), 'Dashboard test', 'Follow up', ${doctor}) RETURNING id
  `;
  await tx`INSERT INTO clinical.discharge_tasks (plan_id, code) VALUES (${discharge.id}, 'pending_results')`;
  return { unit, outsideUnit, emptyUnit, admission, admission2, patient, handover: handover.id, consultant };
});
await sql.end();

const doctor = await login('+44 7700 902001');
const outside = await login('+44 7700 902003');
const nurse = await login('+44 7700 902004');
const admin = await login('+44 7700 900999');

const unauthorized = await get(`/dashboard/ward-summary?unit_id=${ids.unit}`);
assert(unauthorized.status === 401, `dashboard without session returned ${unauthorized.status}`);
const missingUnit = await get('/dashboard/ward-summary', doctor);
assert(missingUnit.status === 400, `missing unit returned ${missingUnit.status}`);
const invalidUnit = await get('/dashboard/ward-summary?unit_id=not-a-uuid', doctor);
assert(invalidUnit.status === 400, `invalid unit returned ${invalidUnit.status}`);
const foreignUnit = await get(`/dashboard/ward-summary?unit_id=${ids.outsideUnit}`, doctor);
assert(foreignUnit.status === 403, `foreign unit returned ${foreignUnit.status}`);
const emptyResponse = await get(`/dashboard/ward-summary?unit_id=${ids.emptyUnit}`, doctor);
const empty = await emptyResponse.json() as Record<string, number | boolean>;
assert(emptyResponse.ok && Object.entries(empty).every(([key, value]) => key === 'claim_data_visible' || value === 0), 'empty unit summary not zero');

const doctorResponse = await get(`/dashboard/ward-summary?unit_id=${ids.unit}`, doctor);
const summary = await doctorResponse.json() as Record<string, number | boolean>;
assert(doctorResponse.ok, `doctor summary returned ${doctorResponse.status}`);
for (const [key, value] of Object.entries({ news_critical: 1, news_warning: 0, stat_orders: 1, pending_orders: 2, active_shifts: 1, unsigned_handovers: 1, tpa_queries: 1, master_warnings: 2, master_cautions: 3, claim_data_visible: true })) {
  assert(summary[key] === value, `doctor summary ${key}: expected ${value}, got ${summary[key]}`);
}
const adminResponse = await get(`/dashboard/ward-summary?unit_id=${ids.unit}`, admin);
const adminSummary = await adminResponse.json() as Record<string, number | boolean>;
assert(adminResponse.ok && adminSummary.news_critical === 1 && adminSummary.news_warning === 1 && adminSummary.unsigned_handovers === 2, 'admin summary omitted scoped patients or single-red warning');
const nurseResponse = await get(`/dashboard/ward-summary?unit_id=${ids.unit}`, nurse);
const nurseSummary = await nurseResponse.json() as Record<string, number | boolean>;
assert(nurseResponse.ok && nurseSummary.news_critical === 1 && nurseSummary.news_warning === 0 && nurseSummary.claim_data_visible === false && nurseSummary.tpa_queries === 0, 'nurse summary scope or claim redaction incorrect');

const anonymousCensus = await get(`/dashboard/census-cards?ids=${ids.admission}`);
assert(anonymousCensus.status === 401, 'census allowed an unauthenticated request');
const nurseCensus = await get(`/dashboard/census-cards?ids=${ids.admission},${ids.admission2}`, nurse);
assert(nurseCensus.ok && (await nurseCensus.json() as { admission_id: string }[]).map((item) => item.admission_id).join(',') === ids.admission, 'nurse census scope incorrect');
const censusResponse = await get(`/dashboard/census-cards?ids=${ids.admission},${ids.admission2}`, doctor);
const census = await censusResponse.json() as { admission_id: string; has_allergies: boolean; scores: number[]; open_alerts: number }[];
assert(censusResponse.ok && census.length === 1 && census[0].admission_id === ids.admission, 'census must exclude admissions outside the user scope');
assert(census[0].has_allergies && census[0].scores.join(',') === '8,0' && census[0].open_alerts === 2, 'census summary incorrect');
const foreignCensus = await get(`/dashboard/census-cards?ids=${ids.admission}`, outside);
assert(foreignCensus.ok && (await foreignCensus.json() as unknown[]).length === 0, 'census leaked a foreign admission');
const invalidCensus = await get('/dashboard/census-cards?ids=invalid', doctor);
assert(invalidCensus.status === 400, 'census accepted invalid ids');

const headerResponse = await get(`/admissions/${ids.admission}/header-summary`, doctor);
assert(headerResponse.ok, `header returned ${headerResponse.status}`);
const header = await headerResponse.json() as {
  patient: { id: string; uhid: string; age: number; allergies: { allergen: string }[] };
  bed: { label: string; ward: string; unit_id: string }; news2: { score: number; escalation: string };
  consultant: { id: string; specialty: string }; payer: { name: string }; claim: { current_usage: string; approved_limit: string; currency: string };
  counts: Record<string, number>;
};
assert(header.patient.id === ids.patient.id && header.patient.uhid === ids.patient.uhid && header.patient.age > 0 && header.patient.allergies[0].allergen === 'Penicillin', 'header patient data incorrect');
assert(header.bed.label === 'D-1' && header.bed.ward === 'Dashboard Ward' && header.bed.unit_id === ids.unit, 'header bed data incorrect');
assert(header.news2.score === 8 && header.news2.escalation === 'high', 'header did not return latest NEWS2');
assert(header.consultant.id === ids.consultant && header.consultant.specialty === 'Cardiology', 'header consultant incorrect');
assert(header.payer.name === 'Dashboard Payer' && header.claim.current_usage === '1234.50' && header.claim.approved_limit === '5000.00' && header.claim.currency === 'INR', 'header claim data incorrect');
for (const [key, value] of Object.entries({ pending_orders: 2, stat_orders: 1, active_alerts: 2, active_referrals: 1, active_shifts: 1, unsigned_handovers: 1, tpa_queries: 1, pending_discharge_tasks: 1 })) {
  assert(header.counts[key] === value, `header ${key}: expected ${value}, got ${header.counts[key]}`);
}
const nurseHeaderResponse = await get(`/admissions/${ids.admission}/header-summary`, nurse);
const nurseHeader = await nurseHeaderResponse.json() as { claim: unknown; claim_data_visible: boolean; counts: { tpa_queries: number } };
assert(nurseHeaderResponse.ok && nurseHeader.claim === null && !nurseHeader.claim_data_visible && nurseHeader.counts.tpa_queries === 0, 'nurse claim redaction incorrect');
const foreignHeader = await get(`/admissions/${ids.admission}/header-summary`, outside);
assert(foreignHeader.status === 403, `foreign admission header returned ${foreignHeader.status}`);
const missingValuesResponse = await get(`/admissions/${ids.admission2}/header-summary`, admin);
const missingValues = await missingValuesResponse.json() as { consultant: unknown; claim: unknown; payer: unknown };
assert(missingValuesResponse.ok && missingValues.consultant === null && missingValues.claim === null && missingValues.payer === null, 'missing header data should be null');
const emptyNewsDb = postgres(process.env.DATABASE_URL);
const [emptyNewsPatient] = await emptyNewsDb<{ id: string }[]>`INSERT INTO clinical.patients (name, dob) VALUES ('Dashboard No Observation', '2000-01-01') RETURNING id`;
const [emptyNewsAdmission] = await emptyNewsDb<{ id: string }[]>`INSERT INTO clinical.admissions (patient_id, unit_id) VALUES (${emptyNewsPatient.id}, ${ids.outsideUnit}) RETURNING id`;
await emptyNewsDb.end();
const emptyNewsResponse = await get(`/admissions/${emptyNewsAdmission.id}/header-summary`, admin);
const emptyNews = await emptyNewsResponse.json() as { news2: unknown };
assert(emptyNewsResponse.ok && emptyNews.news2 === null, 'missing NEWS2 should be null, not a fabricated score');

const alertsResponse = await get(`/admissions/${ids.admission}/alerts?status=active`, nurse);
const alerts = await alertsResponse.json() as { id: string; severity: string }[];
const warning = alerts.find((alert) => alert.severity === 'warning');
assert(warning, 'fixture warning alert missing');
const acknowledge = await fetch(`${baseUrl}/admissions/${ids.admission}/alerts/${warning.id}/acknowledge`, { method: 'POST', headers: { authorization: `Bearer ${nurse}` } });
assert(acknowledge.ok, `alert acknowledgement returned ${acknowledge.status}`);
const acknowledgedSummary = await get(`/dashboard/ward-summary?unit_id=${ids.unit}`, doctor);
const acknowledged = await acknowledgedSummary.json() as { master_warnings: number; news_critical: number };
assert(acknowledged.master_warnings === 1 && acknowledged.news_critical === 1, 'acknowledged alert incorrectly affected clinical severity or warning count');

const updateSql = postgres(process.env.DATABASE_URL);
await updateSql`UPDATE clinical.ipass_items SET status = 'signed', signed_at = now() WHERE id = ${ids.handover}`;
await updateSql.end();
const signedResponse = await get(`/dashboard/ward-summary?unit_id=${ids.unit}`, doctor);
const signed = await signedResponse.json() as { unsigned_handovers: number; master_cautions: number };
assert(signed.unsigned_handovers === 0 && signed.master_cautions === 2, 'signed handover did not update counts');
console.log('Dashboard integration checks passed');
