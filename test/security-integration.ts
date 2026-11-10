import postgres from 'postgres';

const baseUrl = process.env.BASE_URL;
if (!baseUrl) throw new Error('BASE_URL is required');

const DOCTOR_1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const DOCTOR_2 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';

async function login(phone: string) {
  const sql = postgres(process.env.DATABASE_URL!);
  const [account] = await sql<{ email: string }[]>`
    SELECT c.email FROM staff.users u JOIN staff.user_credentials c ON c.user_id = u.id WHERE u.phone = ${phone}
  `;
  await sql.end();
  if (!account) throw new Error(`no test credentials for ${phone}`);
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: 'password' }),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{ token: string; user: { id: string; role: string } }>;
}

async function request(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const unauthorized = await request('/patients');
assert(unauthorized.status === 401, `missing token returned ${unauthorized.status}`);

const openApi = await fetch(`${baseUrl}/openapi.json`).then((response) => response.json()) as {
  paths: Record<string, Record<string, unknown>>;
};
for (const [path, operations] of Object.entries(openApi.paths)) {
  if (path.startsWith('/auth') || path === '/health' || path === '/ready') continue;
  const concretePath = path.replaceAll(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000000');
  for (const method of Object.keys(operations)) {
    const response = await fetch(`${baseUrl}${concretePath}`, { method: method.toUpperCase() });
    assert(response.status === 401, `${method.toUpperCase()} ${path} allowed an unauthenticated request (${response.status})`);
  }
}
const healthResponse = await fetch(`${baseUrl}/health`);
assert(healthResponse.ok && (await healthResponse.json() as { status: string }).status === 'ok', 'health check failed');
const readyResponse = await fetch(`${baseUrl}/ready`);
assert(readyResponse.ok && (await readyResponse.json() as { status: string }).status === 'ready', 'readiness check failed');
const unauthorizedEvents = await fetch(`${baseUrl}/events`);
assert(unauthorizedEvents.status === 401, `event stream allowed unauthenticated access (${unauthorizedEvents.status})`);

const roleMutation = await fetch(`${baseUrl}/auth/request`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone: '+44 7700 900321', name: 'Attacker', role: 'nurse' }),
});
assert(roleMutation.status === 404, `public OTP registration still exists (${roleMutation.status})`);
const admin = await login('+44 7700 900999');

const registrationPhone = '+44 7700 901234';
const registration = await request('/users', admin.token, {
  method: 'POST',
  body: JSON.stringify({
    phone: registrationPhone,
    name: 'Development Clinician',
    role: 'doctor',
    email: 'development+clinician@klinik.com',
    password: 'long-test-password',
  }),
});
assert(registration.ok, `development registration returned ${registration.status}`);
const registeredDoctor = await request('/auth/login', undefined, {
  method: 'POST', body: JSON.stringify({ email: 'development+clinician@klinik.com', password: 'long-test-password' }),
}).then((response) => response.json()) as { token: string; user: { role: string } };
assert(
  registeredDoctor.user.role === 'doctor',
  'development registration created the wrong role'
);

const doctor1 = await login('+44 7700 900321');
const doctor2 = await login('+44 7700 900322');
const doctor3 = await login('+44 7700 900323');
const nurse = await login('+44 7700 900654');
assert(doctor1.user.id === DOCTOR_1 && doctor1.user.role === 'doctor', 'login changed user identity or role');
assert(admin.user.role === 'admin', 'administrator seed role is invalid');

const doctor1AdmissionsResponse = await request('/admissions?scope=mine', doctor1.token);
const doctor1DefaultAdmissionsResponse = await request('/admissions', doctor1.token);
const doctor2AdmissionsResponse = await request('/admissions?scope=mine', doctor2.token);
assert(doctor1AdmissionsResponse.ok && doctor2AdmissionsResponse.ok, 'could not list seeded admissions');
const doctor1Admissions = await doctor1AdmissionsResponse.json() as { id: string; patient_id: string; assigned_to: string | null }[];
const doctor1DefaultAdmissions = await doctor1DefaultAdmissionsResponse.json() as { id: string }[];
assert(doctor1DefaultAdmissions.length === doctor1Admissions.length, 'doctor default census escaped assigned scope');
const doctor2Admissions = await doctor2AdmissionsResponse.json() as { id: string; patient_id: string }[];
const doctor1Admission = doctor1Admissions.find((admission) => admission.assigned_to);
const doctor2Admission = doctor2Admissions[0];
assert(doctor1Admission && doctor2Admission, 'seeded test admissions missing');

const nursingAssessmentBody = {
  arrival_source: 'Emergency', transport_mode: 'Stretcher', identity_verified: true, allergy_verified: true,
  dependence: 'Fully dependent', skin: 'Intact', pain_score: 4,
  morse: { history: 25, secondary: 15, aid: 0, iv: 20, gait: 10, mental: 0 },
  braden: { sensory: 2, moisture: 2, activity: 1, mobility: 1, nutrition: 2, friction: 1 },
  must: { bmi: 1, weight_loss: 1, acute: 0 },
};
const assessmentResponse = await request(`/admissions/${doctor1Admission.id}/nursing-assessments`, nurse.token, {
  method: 'POST', body: JSON.stringify(nursingAssessmentBody),
});
assert(assessmentResponse.status === 201, `nursing assessment returned ${assessmentResponse.status}`);
const assessment = await assessmentResponse.json() as { morse_score: number; braden_score: number; must_score: number };
assert(assessment.morse_score === 70 && assessment.braden_score === 9 && assessment.must_score === 2, 'nursing assessment scores incorrect');
const planResponse = await request(`/admissions/${doctor1Admission.id}/care-plan`, nurse.token);
const plan = await planResponse.json() as { generated: string[] };
assert(planResponse.ok && plan.generated.length >= 3, 'generated care plan missing');
const planCreateResponse = await request(`/admissions/${doctor1Admission.id}/care-plan`, nurse.token, {
  method: 'POST', body: JSON.stringify({ problem: 'Skin integrity', intervention: 'Inspect each shift' }),
});
assert(planCreateResponse.status === 201, `care-plan creation returned ${planCreateResponse.status}`);
const planItem = await planCreateResponse.json() as { id: string; revision: number };
const planResolve = await request(`/nursing-care-plan/${planItem.id}`, nurse.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: planItem.revision, status: 'resolved', resolution_reason: 'Skin intact' }),
});
assert(planResolve.ok, `care-plan resolution returned ${planResolve.status}`);
const stalePlan = await request(`/nursing-care-plan/${planItem.id}`, nurse.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: planItem.revision, intervention: 'Stale edit' }),
});
assert(stalePlan.status === 409, `stale care-plan update returned ${stalePlan.status}`);
const nursingTasksResponse = await request(`/admissions/${doctor1Admission.id}/nursing-tasks`, nurse.token);
assert(nursingTasksResponse.ok && (await nursingTasksResponse.json() as unknown[]).length >= 2, 'risk-based nursing tasks missing');
const scheduledTask = await request(`/admissions/${doctor1Admission.id}/nursing-tasks`, nurse.token, {
  method: 'POST', body: JSON.stringify({ description: 'Hourly urine check', interval_minutes: 60, due_at: new Date(Date.now() - 60_000).toISOString() }),
});
assert(scheduledTask.status === 201, `recurring task creation returned ${scheduledTask.status}`);
const nursingTask = await scheduledTask.json() as { id: string };
const completedNursingTask = await request(`/nursing-tasks/${nursingTask.id}/complete`, nurse.token, { method: 'POST', body: JSON.stringify({ expected_due_at: nursingTask.due_at }) });
assert(completedNursingTask.ok, `recurring task completion returned ${completedNursingTask.status}`);
const duplicateNursingTask = await request(`/nursing-tasks/${nursingTask.id}/complete`, nurse.token, { method: 'POST', body: JSON.stringify({ expected_due_at: nursingTask.due_at }) });
assert(duplicateNursingTask.status === 409, `duplicate task completion returned ${duplicateNursingTask.status}`);
const fluid = await request(`/admissions/${doctor1Admission.id}/fluid-entries`, nurse.token, {
  method: 'POST', body: JSON.stringify({ direction: 'output', category: 'urine', volume_ml: 30, occurred_at: new Date().toISOString() }),
});
assert(fluid.status === 201, `fluid recording returned ${fluid.status}`);
const weightResponse = await request(`/admissions/${doctor1Admission.id}/weights`, nurse.token, {
  method: 'POST', body: JSON.stringify({ weight_kg: 60, measured_at: new Date(Date.now() - 60000).toISOString() }),
});
assert(weightResponse.status === 201, `weight recording returned ${weightResponse.status}`);
const hourStart = Math.floor(Date.now() / 3600_000) * 3600_000;
for (const offset of [0.5, 1.5]) {
  const previousUrine = await request(`/admissions/${doctor1Admission.id}/fluid-entries`, nurse.token, {
    method: 'POST', body: JSON.stringify({ direction: 'output', category: 'urine', volume_ml: 20, occurred_at: new Date(hourStart - offset * 3600_000).toISOString() }),
  });
  assert(previousUrine.status === 201, `historical urine recording returned ${previousUrine.status}`);
}
const fluidRange = `from=${encodeURIComponent(new Date(Date.now() - 3 * 3600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`;
const fluidBalanceResponse = await request(`/admissions/${doctor1Admission.id}/fluid-entries?${fluidRange}`, nurse.token);
const fluidBalance = await fluidBalanceResponse.json() as { output_ml: number; balance_ml: number; urine_alert: { status: string } };
assert(fluidBalance.output_ml === 70 && fluidBalance.balance_ml === -70, 'fluid balance incorrect');
assert(fluidBalance.urine_alert.status === 'low', 'low two-hour urine output not detected');
const urineAlertsResponse = await request(`/admissions/${doctor1Admission.id}/alerts?status=active`, nurse.token);
const urineAlerts = await urineAlertsResponse.json() as { id: string; type: string }[];
assert(urineAlerts.filter((alert) => alert.type === 'low_urine_output').length === 1, 'low urine escalation missing or duplicated');
const zeroUrine = await request(`/admissions/${doctor1Admission.id}/fluid-entries`, nurse.token, {
  method: 'POST', body: JSON.stringify({ direction: 'output', category: 'urine', volume_ml: 0, occurred_at: new Date().toISOString() }),
});
assert(zeroUrine.status === 201, `zero urine output returned ${zeroUrine.status}`);
const secondNursingAdmission = doctor1Admissions.find((admission) => admission.assigned_to === nurse.user.id && admission.id !== doctor1Admission.id);
assert(secondNursingAdmission, 'second nurse-assigned admission missing');
for (const offset of [0.5, 1.5]) {
  const entry = await request(`/admissions/${secondNursingAdmission.id}/fluid-entries`, nurse.token, {
    method: 'POST', body: JSON.stringify({ direction: 'output', category: 'urine', volume_ml: 0, occurred_at: new Date(hourStart - offset * 3600_000).toISOString() }),
  });
  assert(entry.status === 201, `zero urine recording returned ${entry.status}`);
}
const lateWeight = await request(`/admissions/${secondNursingAdmission.id}/weights`, nurse.token, {
  method: 'POST', body: JSON.stringify({ weight_kg: 60, measured_at: new Date(Date.now() - 60000).toISOString() }),
});
assert(lateWeight.status === 201, `late weight returned ${lateWeight.status}`);
const lateWeightAlertsResponse = await request(`/admissions/${secondNursingAdmission.id}/alerts?status=active`, nurse.token);
const lateWeightAlerts = await lateWeightAlertsResponse.json() as { type: string }[];
assert(lateWeightAlerts.filter((alert) => alert.type === 'low_urine_output').length === 1, 'weight added after urine did not trigger escalation');
const callResponse = await request(`/admissions/${doctor1Admission.id}/sbar-calls`, nurse.token, {
  method: 'POST', body: JSON.stringify({ doctor_id: DOCTOR_1, situation: 'Concern', background: 'Recent admission', assessment: 'Needs review', request: 'immediate' }),
});
assert(callResponse.status === 201, `SBAR call returned ${callResponse.status}`);
const call = await callResponse.json() as { id: string };
const callAck = await request(`/sbar-calls/${call.id}/acknowledge`, doctor1.token, { method: 'POST', body: JSON.stringify({ reply: 'Coming to bedside' }) });
assert(callAck.ok, `SBAR acknowledgement returned ${callAck.status}`);
const callClose = await request(`/sbar-calls/${call.id}/close`, nurse.token, { method: 'POST' });
assert(callClose.ok, `SBAR close returned ${callClose.status}`);

const medicationOrderResponse = await request(`/admissions/${doctor1Admission.id}/orders`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ kind: 'medication', payload: { drug: 'Test medicine', dose: '10 mg', route: 'oral' } }),
});
assert(medicationOrderResponse.status === 201, `medication order returned ${medicationOrderResponse.status}`);
const medicationOrder = await medicationOrderResponse.json() as { id: string };
const medicationConfirm = await request(`/orders/${medicationOrder.id}/confirm`, doctor1.token, { method: 'POST', body: '{}' });
assert(medicationConfirm.ok, `medication confirmation returned ${medicationConfirm.status}`);
const scheduleResponse = await request(`/orders/${medicationOrder.id}/medication-schedule`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ drug: 'Test medicine', dose: '10 mg', route: 'oral' }),
});
assert(scheduleResponse.status === 201, `medication schedule returned ${scheduleResponse.status}`);
const schedule = await scheduleResponse.json() as { id: string };
const medicationDoseResponse = await request(`/medication-schedules/${schedule.id}/doses`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ due_at: new Date().toISOString() }),
});
assert(medicationDoseResponse.status === 201, `dose scheduling returned ${medicationDoseResponse.status}`);
const medicationDose = await medicationDoseResponse.json() as { id: string };
const medicationPatientResponse = await request(`/patients/${doctor1Admission.patient_id}`, doctor1.token);
const medicationPatient = await medicationPatientResponse.json() as { uhid: string; revision: number | string };
const giveBody = { scanned_uhid: medicationPatient.uhid, drug: 'Test medicine', dose: '10 mg', route: 'oral', allergy_checked: true, time_checked: true };
const unreviewedGive = await request(`/medication-doses/${medicationDose.id}/give`, nurse.token, { method: 'POST', body: JSON.stringify(giveBody) });
assert(unreviewedGive.status === 409, `unreviewed dose returned ${unreviewedGive.status}`);
const allergyReview = await request(`/medication-schedules/${schedule.id}/allergy-review`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ decision: 'safe', reason: 'Clinician reviewed allergies' }),
});
assert(allergyReview.status === 201, `allergy review returned ${allergyReview.status}`);
const patientUpdate = await request(`/patients/${doctor1Admission.patient_id}`, doctor1.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: Number(medicationPatient.revision), address: 'Updated for review expiry test' }),
});
assert(patientUpdate.ok, `patient update returned ${patientUpdate.status}`);
const staleReviewGive = await request(`/medication-doses/${medicationDose.id}/give`, nurse.token, { method: 'POST', body: JSON.stringify(giveBody) });
assert(staleReviewGive.status === 409, `stale allergy review returned ${staleReviewGive.status}`);
const refreshedReview = await request(`/medication-schedules/${schedule.id}/allergy-review`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ decision: 'safe', reason: 'Clinician reviewed updated record' }),
});
assert(refreshedReview.status === 201, `refreshed allergy review returned ${refreshedReview.status}`);
const wrongPatientGive = await request(`/medication-doses/${medicationDose.id}/give`, nurse.token, {
  method: 'POST', body: JSON.stringify({ ...giveBody, scanned_uhid: 'WRONG' }),
});
assert(wrongPatientGive.status === 409, `wrong wristband returned ${wrongPatientGive.status}`);
const medicationGive = await request(`/medication-doses/${medicationDose.id}/give`, nurse.token, { method: 'POST', body: JSON.stringify(giveBody) });
assert(medicationGive.ok, `dose administration returned ${medicationGive.status}`);
const duplicateGive = await request(`/medication-doses/${medicationDose.id}/give`, nurse.token, { method: 'POST', body: JSON.stringify(giveBody) });
assert(duplicateGive.status === 409, `duplicate administration returned ${duplicateGive.status}`);
const heldDoseResponse = await request(`/medication-schedules/${schedule.id}/doses`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ due_at: new Date(Date.now() + 60_000).toISOString() }),
});
const heldDose = await heldDoseResponse.json() as { id: string };
const hold = await request(`/medication-doses/${heldDose.id}/hold`, nurse.token, { method: 'POST', body: JSON.stringify({ reason: 'Patient refused' }) });
assert(hold.ok, `dose hold returned ${hold.status}`);
const doctorNotificationsResponse = await request('/notifications', doctor1.token);
const doctorNotifications = await doctorNotificationsResponse.json() as { type: string; payload: { dose_id?: string } }[];
assert(doctorNotifications.some((notification) => notification.type === 'medication.held' && notification.payload.dose_id === heldDose.id), 'held dose did not notify the duty doctor');
assert(doctorNotifications.some((notification) => notification.type === 'nursing.low_urine_output'), 'low urine alert did not notify the doctor');
const missedDoseResponse = await request(`/medication-schedules/${schedule.id}/doses`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ due_at: new Date(Date.now() - 60000).toISOString() }),
});
assert(missedDoseResponse.status === 201, `missed-dose scheduling returned ${missedDoseResponse.status}`);
const missedDose = await missedDoseResponse.json() as { id: string };
const markedMissed = await request(`/medication-doses/${missedDose.id}/missed`, nurse.token, { method: 'POST', body: JSON.stringify({ reason: 'Patient was away' }) });
assert(markedMissed.ok, `missed-dose recording returned ${markedMissed.status}`);
const repeatMissed = await request(`/medication-doses/${missedDose.id}/missed`, nurse.token, { method: 'POST', body: JSON.stringify({ reason: 'Retry' }) });
assert(repeatMissed.status === 409, `repeat missed-dose recording returned ${repeatMissed.status}`);
const prnPayload = { drug: 'PRN example', dose: '5 mg', route: 'oral', prn_indication: 'Pain', prn_min_interval_minutes: 60, prn_max_doses_24h: 2 };
const prnOrderResponse = await request(`/admissions/${doctor1Admission.id}/orders`, doctor1.token, { method: 'POST', body: JSON.stringify({ kind: 'medication', payload: prnPayload }) });
assert(prnOrderResponse.status === 201, `PRN order returned ${prnOrderResponse.status}`);
const prnOrder = await prnOrderResponse.json() as { id: string };
const prnConfirm = await request(`/orders/${prnOrder.id}/confirm`, doctor1.token, { method: 'POST', body: '{}' });
assert(prnConfirm.ok, `PRN confirmation returned ${prnConfirm.status}`);
const prnScheduleResponse = await request(`/orders/${prnOrder.id}/medication-schedule`, doctor1.token, { method: 'POST', body: JSON.stringify(prnPayload) });
assert(prnScheduleResponse.status === 201, `PRN schedule returned ${prnScheduleResponse.status}`);
const prnSchedule = await prnScheduleResponse.json() as { id: string };
const prnReview = await request(`/medication-schedules/${prnSchedule.id}/allergy-review`, doctor1.token, { method: 'POST', body: JSON.stringify({ decision: 'safe', reason: 'Clinician reviewed allergies' }) });
assert(prnReview.status === 201, `PRN review returned ${prnReview.status}`);
const prnPrepare = await request(`/medication-schedules/${prnSchedule.id}/prn-doses`, nurse.token, { method: 'POST' });
assert(prnPrepare.status === 201, `PRN preparation returned ${prnPrepare.status}`);
const prnDose = await prnPrepare.json() as { id: string };
const prnGiveBody = { scanned_uhid: medicationPatient.uhid, drug: 'PRN example', dose: '5 mg', route: 'oral', allergy_checked: true, time_checked: true, administration_reason: 'Pain' };
const simultaneousPrn = await Promise.all([1, 2].map(() => request(`/medication-doses/${prnDose.id}/give`, nurse.token, { method: 'POST', body: JSON.stringify(prnGiveBody) })));
assert(simultaneousPrn.filter((result) => result.status === 200).length === 1 && simultaneousPrn.filter((result) => result.status === 409).length === 1, 'concurrent PRN administration was not serialized');
const nextPrnPrepare = await request(`/medication-schedules/${prnSchedule.id}/prn-doses`, nurse.token, { method: 'POST' });
assert(nextPrnPrepare.status === 201, `second PRN preparation returned ${nextPrnPrepare.status}`);
const nextPrn = await nextPrnPrepare.json() as { id: string };
const tooSoonPrn = await request(`/medication-doses/${nextPrn.id}/give`, nurse.token, { method: 'POST', body: JSON.stringify(prnGiveBody) });
assert(tooSoonPrn.status === 409, `PRN minimum interval was bypassed (${tooSoonPrn.status})`);
const concurrentPayload = { drug: 'Concurrent PRN', dose: '1 mg', route: 'oral', prn_indication: 'Pain', prn_min_interval_minutes: 60, prn_max_doses_24h: 1 };
const concurrentOrderResponse = await request(`/admissions/${doctor1Admission.id}/orders`, doctor1.token, { method: 'POST', body: JSON.stringify({ kind: 'medication', payload: concurrentPayload }) });
const concurrentOrder = await concurrentOrderResponse.json() as { id: string };
await request(`/orders/${concurrentOrder.id}/confirm`, doctor1.token, { method: 'POST', body: '{}' });
const concurrentScheduleResponse = await request(`/orders/${concurrentOrder.id}/medication-schedule`, doctor1.token, { method: 'POST', body: JSON.stringify(concurrentPayload) });
assert(concurrentScheduleResponse.status === 201, `concurrent PRN schedule returned ${concurrentScheduleResponse.status}`);
const concurrentSchedule = await concurrentScheduleResponse.json() as { id: string };
const concurrentReview = await request(`/medication-schedules/${concurrentSchedule.id}/allergy-review`, doctor1.token, { method: 'POST', body: JSON.stringify({ decision: 'safe', reason: 'Clinician reviewed allergies' }) });
assert(concurrentReview.status === 201, `concurrent PRN review returned ${concurrentReview.status}`);
const simultaneousDoseIds: string[] = [];
for (const offset of [2000, 1000]) {
  const response = await request(`/medication-schedules/${concurrentSchedule.id}/doses`, doctor1.token, { method: 'POST', body: JSON.stringify({ due_at: new Date(Date.now() - offset).toISOString() }) });
  assert(response.status === 201, `concurrent PRN dose scheduling returned ${response.status}`);
  simultaneousDoseIds.push((await response.json() as { id: string }).id);
}
const concurrentGiveBody = { scanned_uhid: medicationPatient.uhid, drug: 'Concurrent PRN', dose: '1 mg', route: 'oral', allergy_checked: true, time_checked: true, administration_reason: 'Pain' };
const differentPrnDoses = await Promise.all(simultaneousDoseIds.map((id) => request(`/medication-doses/${id}/give`, nurse.token, { method: 'POST', body: JSON.stringify(concurrentGiveBody) })));
assert(differentPrnDoses.filter((response) => response.status === 200).length === 1 && differentPrnDoses.filter((response) => response.status === 409).length === 1, 'concurrent different PRN doses bypassed interval or maximum');
const updatedPatientResponse = await request(`/patients/${doctor1Admission.patient_id}`, doctor1.token);
const updatedPatient = await updatedPatientResponse.json() as { revision: number | string; allergies: { allergen: string }[] };
const allergyUpdate = await request(`/patients/${doctor1Admission.patient_id}`, doctor1.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: Number(updatedPatient.revision), allergies: [...updatedPatient.allergies, { allergen: 'Known allergen' }] }),
});
assert(allergyUpdate.ok, `allergy update returned ${allergyUpdate.status}`);
const allergicOrderResponse = await request(`/admissions/${doctor1Admission.id}/orders`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ kind: 'medication', payload: { drug: 'Known allergen', dose: '5 mg', route: 'oral' } }),
});
const allergicOrder = await allergicOrderResponse.json() as { id: string };
await request(`/orders/${allergicOrder.id}/confirm`, doctor1.token, { method: 'POST', body: '{}' });
const allergicScheduleResponse = await request(`/orders/${allergicOrder.id}/medication-schedule`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ drug: 'Known allergen', dose: '5 mg', route: 'oral' }),
});
const allergicSchedule = await allergicScheduleResponse.json() as { id: string };
const allergicReview = await request(`/medication-schedules/${allergicSchedule.id}/allergy-review`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ decision: 'safe', reason: 'Reviewed for test' }),
});
assert(allergicReview.status === 201, `allergy review returned ${allergicReview.status}`);
const allergicDoseResponse = await request(`/medication-schedules/${allergicSchedule.id}/doses`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ due_at: new Date().toISOString() }),
});
const allergicDose = await allergicDoseResponse.json() as { id: string };
const allergicGive = await request(`/medication-doses/${allergicDose.id}/give`, nurse.token, {
  method: 'POST', body: JSON.stringify({ scanned_uhid: medicationPatient.uhid, drug: 'Known allergen', dose: '5 mg', route: 'oral', allergy_checked: true, time_checked: true }),
});
assert(allergicGive.status === 409, `known allergy did not block administration (${allergicGive.status})`);
const infusionOrderResponse = await request(`/admissions/${doctor1Admission.id}/orders`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ kind: 'medication', payload: { drug: 'Test infusion', dose: '100 mg', route: 'IV infusion' } }),
});
const infusionOrder = await infusionOrderResponse.json() as { id: string };
const infusionConfirm = await request(`/orders/${infusionOrder.id}/confirm`, doctor1.token, { method: 'POST', body: '{}' });
assert(infusionConfirm.ok, `infusion order confirmation returned ${infusionConfirm.status}`);
const infusionScheduleResponse = await request(`/orders/${infusionOrder.id}/medication-schedule`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ drug: 'Test infusion', dose: '100 mg', route: 'IV infusion' }),
});
const infusionSchedule = await infusionScheduleResponse.json() as { id: string };
const infusionReview = await request(`/medication-schedules/${infusionSchedule.id}/allergy-review`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ decision: 'safe', reason: 'Clinician reviewed allergies' }),
});
assert(infusionReview.ok, `infusion allergy review returned ${infusionReview.status}`);
const infusionBody = { scanned_uhid: medicationPatient.uhid, drug: 'Test infusion', dose: '100 mg', route: 'IV infusion', allergy_checked: true, reason: 'Per order' };
const infusionStart = await request(`/medication-schedules/${infusionSchedule.id}/infusions`, nurse.token, {
  method: 'POST', body: JSON.stringify({ ...infusionBody, action: 'start', rate: '10 ml/h' }),
});
assert(infusionStart.status === 201, `infusion start returned ${infusionStart.status}`);
const duplicateInfusionStart = await request(`/medication-schedules/${infusionSchedule.id}/infusions`, nurse.token, {
  method: 'POST', body: JSON.stringify({ ...infusionBody, action: 'start', rate: '10 ml/h' }),
});
assert(duplicateInfusionStart.status === 409, `duplicate infusion start returned ${duplicateInfusionStart.status}`);
const infusionRate = await request(`/medication-schedules/${infusionSchedule.id}/infusions`, nurse.token, {
  method: 'POST', body: JSON.stringify({ ...infusionBody, action: 'rate_change', rate: '12 ml/h' }),
});
assert(infusionRate.status === 201, `infusion rate change returned ${infusionRate.status}`);
const infusionStop = await request(`/medication-schedules/${infusionSchedule.id}/infusions`, nurse.token, {
  method: 'POST', body: JSON.stringify({ ...infusionBody, action: 'stop' }),
});
assert(infusionStop.status === 201, `infusion stop returned ${infusionStop.status}`);
const demoCatalogResponse = await request('/medication-catalog?q=Amoxicillin', doctor1.token);
assert(demoCatalogResponse.ok, `demo medication catalogue returned ${demoCatalogResponse.status}`);
const demoCatalog = await demoCatalogResponse.json() as { id: string; brand: string; synthetic: boolean }[];
assert(demoCatalog.length === 1 && demoCatalog[0].synthetic, 'synthetic medication catalogue entry missing');
const demoPatientResponse = await request(`/patients/${doctor1Admission.patient_id}`, doctor1.token);
const demoPatient = await demoPatientResponse.json() as { revision: number | string; allergies: { allergen: string }[] };
const demoAllergyUpdate = await request(`/patients/${doctor1Admission.patient_id}`, doctor1.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: Number(demoPatient.revision), allergies: [...demoPatient.allergies, { allergen: 'Penicillin' }] }),
});
assert(demoAllergyUpdate.ok, `demo allergy update returned ${demoAllergyUpdate.status}`);
const demoPayload = { drug: demoCatalog[0].brand, dose: '1 demo unit', route: 'oral', catalog_id: demoCatalog[0].id };
const demoOrderResponse = await request(`/admissions/${doctor1Admission.id}/orders`, doctor1.token, { method: 'POST', body: JSON.stringify({ kind: 'medication', payload: demoPayload }) });
const demoOrder = await demoOrderResponse.json() as { id: string };
await request(`/orders/${demoOrder.id}/confirm`, doctor1.token, { method: 'POST', body: '{}' });
const demoScheduleResponse = await request(`/orders/${demoOrder.id}/medication-schedule`, doctor1.token, { method: 'POST', body: JSON.stringify(demoPayload) });
assert(demoScheduleResponse.status === 201, `demo catalogue schedule returned ${demoScheduleResponse.status}`);
const demoSchedule = await demoScheduleResponse.json() as { id: string };
await request(`/medication-schedules/${demoSchedule.id}/allergy-review`, doctor1.token, { method: 'POST', body: JSON.stringify({ decision: 'safe', reason: 'Synthetic test review' }) });
const demoDoseResponse = await request(`/medication-schedules/${demoSchedule.id}/doses`, doctor1.token, { method: 'POST', body: JSON.stringify({ due_at: new Date().toISOString() }) });
const demoDose = await demoDoseResponse.json() as { id: string };
const demoGive = await request(`/medication-doses/${demoDose.id}/give`, nurse.token, {
  method: 'POST', body: JSON.stringify({ scanned_uhid: medicationPatient.uhid, drug: demoPayload.drug, dose: demoPayload.dose, route: demoPayload.route, allergy_checked: true, time_checked: true }),
});
assert(demoGive.status === 409, `synthetic cross-reactivity did not block dose (${demoGive.status})`);
const allergicOpd = await request('/opd/check-ins', doctor1.token, {
  method: 'POST', body: JSON.stringify({ patient_id: doctor1Admission.patient_id, chief_complaints: ['Demo'] }),
});
assert(allergicOpd.status === 201, `allergic OPD check-in returned ${allergicOpd.status}`);
const allergicVisit = await allergicOpd.json() as { id: string };
const opdPrescription = { medication_id: demoCatalog[0].id, dose: 'demo dose', route: 'oral', frequency: 'daily', duration: '3 days' };
const rejectedOpdPrescription = await request(`/opd/visits/${allergicVisit.id}/prescriptions`, doctor1.token, { method: 'POST', body: JSON.stringify(opdPrescription) });
assert(rejectedOpdPrescription.status === 409, `OPD allergy conflict returned ${rejectedOpdPrescription.status}`);
const overriddenOpdPrescription = await request(`/opd/visits/${allergicVisit.id}/prescriptions`, doctor1.token, { method: 'POST', body: JSON.stringify({ ...opdPrescription, allergy_override_reason: 'Synthetic test reason' }) });
assert(overriddenOpdPrescription.status === 201, `OPD allergy override returned ${overriddenOpdPrescription.status}`);

const consultantWorklist = await request('/consultant-rounds/worklist', doctor2.token);
assert(consultantWorklist.ok, `consultant worklist returned ${consultantWorklist.status}`);
const consultantPatients = await consultantWorklist.json() as { admission_id: string }[];
assert(consultantPatients.some((patient) => patient.admission_id === doctor2Admission.id), 'consultant worklist is missing assigned patient');
const roundContext = await request(`/consultant-rounds/${doctor2Admission.id}/context`, doctor2.token);
assert(roundContext.ok, `consultant round context returned ${roundContext.status}`);
const foreignRoundContext = await request(`/consultant-rounds/${doctor1Admission.id}/context`, doctor2.token);
assert(foreignRoundContext.status === 403, `unassigned round context returned ${foreignRoundContext.status}`);
const roundResponse = await request('/consultant-rounds', doctor2.token, {
  method: 'POST', body: JSON.stringify({ admission_id: doctor2Admission.id, subjective: 'Improving', objective: 'Stable', assessment: 'Monitor', plan: 'Continue care', orders: [{ kind: 'clinical', payload: { instruction: 'Review' } }] }),
});
assert(roundResponse.status === 201, `consultant round returned ${roundResponse.status}`);
const round = await roundResponse.json() as { round: { id: string }; orders: { consultant_round_id: string; status: string }[] };
assert(round.orders.length === 1 && round.orders[0].consultant_round_id === round.round.id && round.orders[0].status === 'confirmed', 'round order provenance or signing missing');
const foreignRound = await request('/consultant-rounds', doctor2.token, {
  method: 'POST', body: JSON.stringify({ admission_id: doctor1Admission.id, assessment: 'Assess', plan: 'Plan' }),
});
assert(foreignRound.status === 409, `unassigned patient round returned ${foreignRound.status}`);

const crossAdmission = await request(`/admissions/${doctor2Admission.id}`, doctor1.token);
assert(crossAdmission.status === 403, `cross-doctor admission access returned ${crossAdmission.status}`);

const assignmentResponse = await request(`/admissions/${doctor1Admission.id}/staff-assignments`, admin.token, {
  method: 'POST',
  body: JSON.stringify({ user_id: doctor3.user.id, assignment_type: 'coverage' }),
});
assert(assignmentResponse.status === 201, `staff assignment returned ${assignmentResponse.status}`);
const assignment = await assignmentResponse.json() as { id: string };
const assignedAccess = await request(`/admissions/${doctor1Admission.id}`, doctor3.token);
assert(assignedAccess.ok, `assigned coverage access returned ${assignedAccess.status}`);
const invalidRoleAssignment = await request(`/admissions/${doctor1Admission.id}/staff-assignments`, admin.token, {
  method: 'POST',
  body: JSON.stringify({ user_id: nurse.user.id, assignment_type: 'duty_doctor' }),
});
assert(invalidRoleAssignment.status === 409, `role-mismatched assignment returned ${invalidRoleAssignment.status}`);
const endAssignment = await request(`/admissions/${doctor1Admission.id}/staff-assignments/${assignment.id}`, admin.token, { method: 'DELETE' });
assert(endAssignment.ok, `ending staff assignment returned ${endAssignment.status}`);
const endedAccess = await request(`/admissions/${doctor1Admission.id}`, doctor3.token);
assert(endedAccess.status === 403, `ended staff assignment retained access (${endedAccess.status})`);

const ownUnitsResponse = await request(`/staff/${DOCTOR_1}/units`, doctor1.token);
assert(ownUnitsResponse.ok, `own unit memberships returned ${ownUnitsResponse.status}`);
const ownUnits = await ownUnitsResponse.json() as { unit_id: string }[];
assert(ownUnits.length > 0, 'seeded doctor has no unit membership');
const crossUnits = await request(`/staff/${DOCTOR_1}/units`, doctor2.token);
assert(crossUnits.status === 403, `cross-user unit memberships returned ${crossUnits.status}`);
const adminUnits = await request(`/staff/${DOCTOR_1}/units`, admin.token);
assert(adminUnits.ok, `administrator could not read unit memberships (${adminUnits.status})`);

const ownShifts = await request('/shifts', doctor1.token);
assert(ownShifts.ok && (await ownShifts.json() as unknown[]).length > 0, 'staff member could not read own shifts');
const crossShifts = await request(`/shifts?user_id=${DOCTOR_1}`, doctor2.token);
assert(crossShifts.status === 403, `cross-user shifts returned ${crossShifts.status}`);
const overlappingShift = await request('/shifts', admin.token, {
  method: 'POST',
  body: JSON.stringify({
    user_id: DOCTOR_1,
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    unit_ids: ownUnits.map((unit) => unit.unit_id),
  }),
});
assert(overlappingShift.status === 409, `overlapping shift returned ${overlappingShift.status}`);
const futureShiftResponse = await request('/shifts', admin.token, {
  method: 'POST',
  body: JSON.stringify({
    user_id: DOCTOR_1,
    starts_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    ends_at: new Date(Date.now() + 32 * 60 * 60_000).toISOString(),
    unit_ids: ownUnits.map((unit) => unit.unit_id),
  }),
});
assert(futureShiftResponse.status === 201, `future shift creation returned ${futureShiftResponse.status}`);
const futureShift = await futureShiftResponse.json() as { id: string };
const conflictingActivation = await request(`/shifts/${futureShift.id}/active`, doctor1.token, { method: 'POST' });
assert(conflictingActivation.status === 409, `second active shift returned ${conflictingActivation.status}`);

const crossPatient = await request(`/patients/${doctor2Admission.patient_id}`, doctor3.token);
assert(crossPatient.status === 403, `cross-doctor patient access returned ${crossPatient.status}`);
const formerCreatorAccess = await request(`/patients/${doctor2Admission.patient_id}`, doctor1.token);
assert(formerCreatorAccess.status === 403, `patient creator retained access after reassignment (${formerCreatorAccess.status})`);

const referralResponse = await request('/cross-referrals', doctor1.token, {
  method: 'POST', body: JSON.stringify({ admission_id: doctor1Admission.id, consultant_id: doctor2.user.id, specialty: 'Cardiology', urgency: 'urgent', question: 'Please assess the patient', findings: 'Tachycardia' }),
});
assert(referralResponse.status === 201, `referral creation returned ${referralResponse.status}`);
const referral = await referralResponse.json() as { id: string };
const duplicateReferral = await request('/cross-referrals', doctor1.token, {
  method: 'POST', body: JSON.stringify({ admission_id: doctor1Admission.id, consultant_id: doctor2.user.id, specialty: 'Cardiology', urgency: 'routine', question: 'Repeat assessment' }),
});
assert(duplicateReferral.status === 409, `duplicate referral returned ${duplicateReferral.status}`);
const referredAdmission = await request(`/admissions/${doctor1Admission.id}`, doctor2.token);
assert(referredAdmission.ok, `referred consultant cannot access admission (${referredAdmission.status})`);
const referredPatient = await request(`/patients/${doctor1Admission.patient_id}`, doctor2.token);
assert(referredPatient.ok, `referred consultant cannot access patient (${referredPatient.status})`);
const referredPatientSearch = await request(`/patients/search?q=${encodeURIComponent(medicationPatient.uhid)}`, doctor2.token);
const referredSearchResults = await referredPatientSearch.json() as { id: string }[];
assert(referredSearchResults.some((patient) => patient.id === doctor1Admission.patient_id), 'referred patient missing from scoped search');
const referredPatientList = await request('/patients', doctor2.token);
const referredListResults = await referredPatientList.json() as { id: string }[];
assert(referredListResults.some((patient) => patient.id === doctor1Admission.patient_id), 'referred patient missing from scoped list');
const unauthorizedOpinion = await request(`/cross-referrals/${referral.id}/opinion`, doctor3.token, {
  method: 'POST', body: JSON.stringify({ impression: 'Assessment', recommendations: 'Observe' }),
});
assert(unauthorizedOpinion.status === 403, `non-consultant opinion returned ${unauthorizedOpinion.status}`);
const opinion = await request(`/cross-referrals/${referral.id}/opinion`, doctor2.token, {
  method: 'POST', body: JSON.stringify({ impression: 'Assessment', recommendations: 'Observe' }),
});
assert(opinion.ok, `consultant opinion returned ${opinion.status}`);
const opinionResult = await opinion.json() as { opinion_note_id: string | null };
assert(opinionResult.opinion_note_id, 'consultant opinion did not create a clinical note');
const referralOrder = await request(`/cross-referrals/${referral.id}/orders`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ kind: 'clinical', payload: { instruction: 'Observe' }, priority: 'routine' }),
});
assert(referralOrder.status === 201, `referral order creation returned ${referralOrder.status}`);
const referralOrderBody = await referralOrder.json() as { cross_referral_id: string | null };
assert(referralOrderBody.cross_referral_id === referral.id, 'referral order provenance missing');
const acknowledgeReferral = await request(`/cross-referrals/${referral.id}/acknowledge`, doctor1.token, { method: 'POST' });
assert(acknowledgeReferral.ok, `referral acknowledgement returned ${acknowledgeReferral.status}`);
const closeReferral = await request(`/cross-referrals/${referral.id}/close`, doctor1.token, { method: 'POST' });
assert(closeReferral.ok, `referral closure returned ${closeReferral.status}`);
const closedReferralAccess = await request(`/admissions/${doctor1Admission.id}`, doctor2.token);
assert(closedReferralAccess.status === 403, `closed referral retained patient access (${closedReferralAccess.status})`);

const breakGlass = await request(`/admissions/${doctor2Admission.id}/break-glass`, doctor3.token, {
  method: 'POST',
  body: JSON.stringify({ reason: 'Emergency review requested at bedside' }),
});
assert(breakGlass.status === 201, `break-glass grant returned ${breakGlass.status}`);
const emergencyAccess = await request(`/admissions/${doctor2Admission.id}`, doctor3.token);
assert(emergencyAccess.ok, `break-glass access returned ${emergencyAccess.status}`);

const nurseOpenAdmissionsResponse = await request('/admissions?scope=open', nurse.token);
const nurseOpenAdmissions = await nurseOpenAdmissionsResponse.json() as { assigned_to: string | null }[];
assert(
  nurseOpenAdmissions.length > 0 && nurseOpenAdmissions.every((admission) => admission.assigned_to === nurse.user.id),
  'nurse scope=open escaped assigned census'
);

const unitsResponse = await request('/units', admin.token);
const allUnits = await unitsResponse.json() as { id: string; code: string }[];
const initialUnit = allUnits.find((unit) => unit.code === 'INPATIENT');
assert(initialUnit, 'seed inpatient unit missing');
const units = [initialUnit];
const wardsResponse = await request(`/wards?unit_id=${initialUnit.id}`, admin.token);
const unitWardIds = new Set((await wardsResponse.json() as { id: string }[]).map((ward) => ward.id));
const occupiedBedsResponse = await request('/beds?occupancy=occupied', doctor1.token);
const availableBedsResponse = await request('/beds?occupancy=available', doctor1.token);
assert(occupiedBedsResponse.ok && availableBedsResponse.ok, 'bed topology endpoints failed');
const occupiedBeds = await occupiedBedsResponse.json() as { id: string; ward_id: string; ward_name: string; label: string; occupancy: string }[];
const availableBeds = (await availableBedsResponse.json() as { id: string; ward_id: string; occupancy: string }[]).filter((bed) => unitWardIds.has(bed.ward_id));
assert(occupiedBeds.length === 60 && occupiedBeds.every((bed) => bed.occupancy === 'occupied'), 'active admissions were not mapped to unique beds');
assert(availableBeds.length > 0 && availableBeds.every((bed) => bed.occupancy === 'available'), 'available-bed projection is incorrect');

const doctor2Bed = occupiedBeds.find((bed) => bed.id);
assert(doctor2Bed, 'occupied bed fixture missing');
const wardCensusResponse = await request(`/wards/${doctor2Bed.ward_id}/census`, doctor3.token);
assert(wardCensusResponse.ok, `ward census returned ${wardCensusResponse.status}`);
const wardCensus = await wardCensusResponse.json() as { admission_id: string; assigned_doctor_id: string | null }[];
assert(wardCensus.every((entry) => entry.assigned_doctor_id === doctor3.user.id || entry.assigned_doctor_id === null || entry.admission_id === doctor2Admission.id), 'ward census escaped doctor scope');

const invalidPatient = await request('/patients', doctor1.token, {
  method: 'POST', body: JSON.stringify({ name: '  ', dob: 'not-a-date' }),
});
assert(invalidPatient.status === 400, `invalid patient demographics returned ${invalidPatient.status}`);
const futurePatient = await request('/patients', doctor1.token, {
  method: 'POST', body: JSON.stringify({ name: 'Future patient', dob: '2999-01-01' }),
});
assert(futurePatient.status === 400, `future date of birth returned ${futurePatient.status}`);
const newPatientResponse = await request('/patients', doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ name: 'Bed Conflict Test', dob: '2000-01-01' }),
});
assert(newPatientResponse.status === 201, `test patient creation returned ${newPatientResponse.status}`);
const newPatient = await newPatientResponse.json() as { id: string; uhid: string };
assert(newPatient.uhid.startsWith('UH-'), 'UHID was not generated');
const opdCheckin = await request('/opd/check-ins', doctor1.token, {
  method: 'POST', body: JSON.stringify({ patient_id: newPatient.id, chief_complaints: ['Demo complaint'] }),
});
assert(opdCheckin.status === 201, `OPD check-in returned ${opdCheckin.status}`);
const opdVisit = await opdCheckin.json() as { id: string; revision: number };
const opdTriage = await request(`/opd/visits/${opdVisit.id}/triage`, nurse.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: opdVisit.revision, systolic: 120, diastolic: 80, pulse: 80, temperature: 37, spo2: 98, weight_kg: 65 }),
});
assert(opdTriage.ok, `OPD triage returned ${opdTriage.status}`);
const triagedVisit = await opdTriage.json() as { revision: number };
const opdDraft = await request(`/opd/visits/${opdVisit.id}/draft`, doctor1.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: triagedVisit.revision, consultation_note: 'Assessment and plan', follow_up: '1 week' }),
});
assert(opdDraft.ok, `OPD draft returned ${opdDraft.status}`);
const opdDiagnosis = await request(`/opd/visits/${opdVisit.id}/diagnoses`, doctor1.token, { method: 'POST', body: JSON.stringify({ code: 'R50.9' }) });
assert(opdDiagnosis.status === 201, `OPD diagnosis returned ${opdDiagnosis.status}`);
const opdInvestigation = await request(`/opd/visits/${opdVisit.id}/investigations`, doctor1.token, { method: 'POST', body: JSON.stringify({ code: 'CBC' }) });
assert(opdInvestigation.status === 201, `OPD investigation returned ${opdInvestigation.status}`);
const opdDemoPrescription = await request(`/opd/visits/${opdVisit.id}/prescriptions`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ medication_id: demoCatalog[0].id, dose: '1 demo unit', route: 'oral', frequency: 'daily', duration: '3 days' }),
});
assert(opdDemoPrescription.status === 201, `OPD demo prescription returned ${opdDemoPrescription.status}`);
const opdClose = await request(`/opd/visits/${opdVisit.id}/close`, doctor1.token, { method: 'POST' });
assert(opdClose.ok, `OPD close returned ${opdClose.status}`);
const opdClosed = await opdClose.json() as { charges: { total_amount: string } };
assert(Number(opdClosed.charges.total_amount) === 900, 'OPD charges incorrect');
const opdDispatchesResponse = await request('/opd/dispatches?status=pending', admin.token);
const opdDispatches = await opdDispatchesResponse.json() as { id: string; visit_id: string; kind: string; items: unknown[]; synthetic: boolean }[];
const pharmacyDispatch = opdDispatches.find((dispatch) => dispatch.visit_id === opdVisit.id && dispatch.kind === 'pharmacy');
const collectionDispatch = opdDispatches.find((dispatch) => dispatch.visit_id === opdVisit.id && dispatch.kind === 'collection');
assert(pharmacyDispatch?.synthetic && pharmacyDispatch.items.length === 1 && collectionDispatch?.synthetic && collectionDispatch.items.length === 1, 'signed OPD visit did not create demo dispatches');
const wrongDispatchActor = await request(`/opd/dispatches/${pharmacyDispatch.id}/complete`, nurse.token, { method: 'POST' });
assert(wrongDispatchActor.status === 403, `nurse completed pharmacy dispatch (${wrongDispatchActor.status})`);
const pharmacyComplete = await request(`/opd/dispatches/${pharmacyDispatch.id}/complete`, admin.token, { method: 'POST' });
assert(pharmacyComplete.ok, `pharmacy dispatch completion returned ${pharmacyComplete.status}`);
const collectionComplete = await request(`/opd/dispatches/${collectionDispatch.id}/complete`, nurse.token, { method: 'POST' });
assert(collectionComplete.ok, `collection dispatch completion returned ${collectionComplete.status}`);
const duplicateDispatch = await request(`/opd/dispatches/${collectionDispatch.id}/complete`, nurse.token, { method: 'POST' });
assert(duplicateDispatch.status === 409, `repeat dispatch completion returned ${duplicateDispatch.status}`);
const opdLateChange = await request(`/opd/visits/${opdVisit.id}/diagnoses`, doctor1.token, { method: 'POST', body: JSON.stringify({ code: 'R51.9' }) });
assert(opdLateChange.status === 409, `closed OPD visit accepted new diagnosis (${opdLateChange.status})`);
const newOpdCheckin = await request('/opd/check-ins', doctor1.token, {
  method: 'POST', body: JSON.stringify({ patient: { name: 'OPD New Patient', dob: '2001-01-01', sex: 'female', phone: '+44 7700 555333', allergies: [{ allergen: 'Demo allergy' }] }, chief_complaints: ['Demo reason'] }),
});
assert(newOpdCheckin.status === 201, `new-patient OPD check-in returned ${newOpdCheckin.status}`);
const newOpdVisit = await newOpdCheckin.json() as { id: string; patient_id: string; revision: number };
const newOpdPatientResponse = await request(`/patients/${newOpdVisit.patient_id}`, doctor1.token);
const newOpdPatient = await newOpdPatientResponse.json() as { uhid: string; allergies: { allergen: string }[] };
assert(newOpdPatient.uhid.startsWith('UH-') && newOpdPatient.allergies.some((allergy) => allergy.allergen === 'Demo allergy'), 'OPD registration did not preserve identity or allergies');
const ambiguousCheckin = await request('/opd/check-ins', doctor1.token, {
  method: 'POST', body: JSON.stringify({ patient_id: newPatient.id, patient: { name: 'Duplicate', dob: '2000-01-01' }, chief_complaints: ['Demo'] }),
});
assert(ambiguousCheckin.status === 400, `ambiguous OPD check-in returned ${ambiguousCheckin.status}`);
const opdUnitsResponse = await request('/units', admin.token);
const opdUnits = await opdUnitsResponse.json() as { id: string }[];
assert(opdUnits.length > 0, 'OPD handoff unit missing');
const prematureOpdHandoff = await request(`/opd/visits/${newOpdVisit.id}/admission-request`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ requested_unit_id: opdUnits[0].id, diagnosis: 'Demo diagnosis' }),
});
assert(prematureOpdHandoff.status === 409, `unsigned OPD handoff returned ${prematureOpdHandoff.status}`);
const admitDraft = await request(`/opd/visits/${newOpdVisit.id}/draft`, doctor1.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: newOpdVisit.revision, consultation_note: 'Demo admission handover', follow_up: 'admit' }),
});
assert(admitDraft.ok, `admit draft returned ${admitDraft.status}`);
const closeAdmitVisit = await request(`/opd/visits/${newOpdVisit.id}/close`, doctor1.token, { method: 'POST' });
assert(closeAdmitVisit.ok, `admit visit closure returned ${closeAdmitVisit.status}`);
const opdHandoff = await request(`/opd/visits/${newOpdVisit.id}/admission-request`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ requested_unit_id: opdUnits[0].id, diagnosis: 'Demo diagnosis' }),
});
assert(opdHandoff.status === 201, `OPD admission handoff returned ${opdHandoff.status}`);
const opdAdmissionRequest = await opdHandoff.json() as { patient_id: string; source: string; opd_visit_id: string; clinical_handover: string };
assert(opdAdmissionRequest.patient_id === newOpdVisit.patient_id && opdAdmissionRequest.source === 'opd' && opdAdmissionRequest.opd_visit_id === newOpdVisit.id && opdAdmissionRequest.clinical_handover === 'Demo admission handover', 'OPD admission handoff lost visit data');
const duplicateOpdHandoff = await request(`/opd/visits/${newOpdVisit.id}/admission-request`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ requested_unit_id: opdUnits[0].id, diagnosis: 'Demo diagnosis' }),
});
assert(duplicateOpdHandoff.status === 409, `duplicate OPD handoff returned ${duplicateOpdHandoff.status}`);
const templatesResponse = await request('/forms/templates', doctor1.token);
const templates = await templatesResponse.json() as { id: string; synthetic: boolean; name: string }[];
const demoForm = templates.find((template) => template.synthetic && template.name === 'General consent for admission and treatment');
assert(demoForm, 'synthetic consent template missing');
const formCreate = await request('/forms/instances', doctor1.token, {
  method: 'POST', body: JSON.stringify({ patient_id: newPatient.id, template_id: demoForm.id }),
});
assert(formCreate.status === 201, `form creation returned ${formCreate.status}`);
const formVersion = await formCreate.json() as { id: string; revision: number; form_values: Record<string, unknown> };
assert(formVersion.form_values.uhid === newPatient.uhid, 'form autofill missing UHID');
const formSave = await request(`/forms/versions/${formVersion.id}`, doctor1.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: formVersion.revision, form_values: { ...formVersion.form_values, details: 'Demo consent detail' } }),
});
assert(formSave.ok, `form draft save returned ${formSave.status}`);
const formSignature = await request(`/forms/versions/${formVersion.id}/signatures`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ field_key: 'doctor_signature', signer_name: 'Demo doctor' }),
});
assert(formSignature.status === 201, `form signature returned ${formSignature.status}`);
const patientSignature = await request(`/forms/versions/${formVersion.id}/signatures`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ field_key: 'patient_signature', signer_name: 'Test Patient' }),
});
assert(patientSignature.status === 201, `patient signature returned ${patientSignature.status}`);
const formFinal = await request(`/forms/versions/${formVersion.id}/finalize`, doctor1.token, { method: 'POST' });
assert(formFinal.ok, `form finalization returned ${formFinal.status}`);
const formEditFinal = await request(`/forms/versions/${formVersion.id}`, doctor1.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: 2, form_values: { details: 'Changed' } }),
});
assert(formEditFinal.status === 409, `finalized form changed (${formEditFinal.status})`);
const formNewVersion = await request(`/forms/versions/${formVersion.id}/new-version`, doctor1.token, { method: 'POST' });
assert(formNewVersion.status === 201, `new form version returned ${formNewVersion.status}`);
const newFormVersion = await formNewVersion.json() as { id: string };
const newFormDetails = await request(`/forms/versions/${newFormVersion.id}`, doctor1.token);
const newForm = await newFormDetails.json() as { signatures: unknown[] };
assert(newForm.signatures.length === 0, 'new form version retained signatures');
const identityResponse = await request(`/patients/${newPatient.id}/identity`, doctor1.token);
assert(identityResponse.ok, `identity returned ${identityResponse.status}`);
const identity = await identityResponse.json() as { identifiers: { type: string; value: string }[] };
assert(identity.identifiers.some((identifier) => identifier.type === 'uhid' && identifier.value === newPatient.uhid), 'UHID identity entry missing');
const searchResponse = await request(`/patients/search?q=${encodeURIComponent(newPatient.uhid)}`, doctor1.token);
assert(searchResponse.ok, `patient search returned ${searchResponse.status}`);
const search = await searchResponse.json() as { id: string }[];
assert(search.some((patient) => patient.id === newPatient.id), 'creator cannot search unadmitted patient');
const otherSearchResponse = await request(`/patients/search?q=${encodeURIComponent(newPatient.uhid)}`, doctor2.token);
const otherSearch = await otherSearchResponse.json() as { id: string }[];
assert(!otherSearch.some((patient) => patient.id === newPatient.id), 'search leaked unassigned patient');
const identifierResponse = await request(`/patients/${newPatient.id}/identifiers`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ type: 'abha', value: 'integration-abha-123' }),
});
assert(identifierResponse.status === 201, `identifier creation returned ${identifierResponse.status}`);
const duplicateIdentifier = await request(`/patients/${newPatient.id}/identifiers`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ type: 'abha', value: 'integration-abha-123' }),
});
assert(duplicateIdentifier.status === 409, `duplicate identifier returned ${duplicateIdentifier.status}`);
const secondAbha = await request(`/patients/${newPatient.id}/identifiers`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ type: 'abha', value: 'different-abha-456' }),
});
assert(secondAbha.status === 409, `second ABHA identifier returned ${secondAbha.status}`);
const duplicateAbhaPatient = await request('/patients', doctor1.token, {
  method: 'POST', body: JSON.stringify({ name: 'Duplicate ABHA', dob: '2000-01-01', abha_id: 'integration-abha-123' }),
});
assert(duplicateAbhaPatient.status === 409, `duplicate ABHA patient returned ${duplicateAbhaPatient.status}`);
const contactResponse = await request(`/patients/${newPatient.id}/contacts`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ type: 'phone', value: '+44 7700 123456', is_primary: true }),
});
assert(contactResponse.status === 201, `contact creation returned ${contactResponse.status}`);
const concurrentContacts = await Promise.all(['+44 7700 555001', '+44 7700 555002'].map((value) => request(`/patients/${newPatient.id}/contacts`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ type: 'phone', value, is_primary: true }),
})));
assert(concurrentContacts.every((response) => response.status === 201), 'concurrent primary contact updates did not serialize');
const updatedIdentityResponse = await request(`/patients/${newPatient.id}/identity`, doctor1.token);
const updatedIdentity = await updatedIdentityResponse.json() as { contacts: { type: string; is_primary: boolean }[] };
assert(updatedIdentity.contacts.filter((contact) => contact.type === 'phone' && contact.is_primary).length === 1, 'patient has multiple primary phones');
const kinResponse = await request(`/patients/${newPatient.id}/next-of-kin`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ name: 'Relative', relationship: 'Sibling', phone: '+44 7700 111111', is_primary: true }),
});
assert(kinResponse.status === 201, `next-of-kin creation returned ${kinResponse.status}`);
const invalidCoverage = await request(`/patients/${newPatient.id}/coverage`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ payer_name: 'Test Payer', policy_number: 'INVALID', valid_from: '2026-12-01', valid_until: '2026-01-01' }),
});
assert(invalidCoverage.status === 400, `invalid coverage dates returned ${invalidCoverage.status}`);
const coverageResponse = await request(`/patients/${newPatient.id}/coverage`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ payer_name: 'Test Payer', policy_number: 'POL-001', is_primary: true }),
});
assert(coverageResponse.status === 201, `coverage creation returned ${coverageResponse.status}`);
const coverage = await coverageResponse.json() as { id: string };
const duplicatesResponse = await request('/patients/duplicate-candidates', doctor1.token, {
  method: 'POST', body: JSON.stringify({ name: 'Bed Conflict Test', dob: '2000-01-01' }),
});
assert(duplicatesResponse.ok, `duplicate candidate lookup returned ${duplicatesResponse.status}`);
const duplicates = await duplicatesResponse.json() as { id: string }[];
assert(duplicates.some((patient) => patient.id === newPatient.id), 'duplicate candidate was not found');
const otherDuplicatesResponse = await request('/patients/duplicate-candidates', doctor2.token, {
  method: 'POST', body: JSON.stringify({ name: 'Bed Conflict Test', dob: '2000-01-01' }),
});
const otherDuplicates = await otherDuplicatesResponse.json() as { id: string }[];
assert(!otherDuplicates.some((patient) => patient.id === newPatient.id), 'duplicate lookup leaked an unassigned patient');
const unknownLegacyBed = await request('/admissions', doctor1.token, {
  method: 'POST', body: JSON.stringify({ patient_id: newPatient.id, ward: 'Unknown Ward', bed: 'Unknown Bed' }),
});
assert(unknownLegacyBed.status === 409, `unknown legacy bed accepted (${unknownLegacyBed.status})`);
const bedConflict = await request('/admissions', doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ patient_id: newPatient.id, bed_id: occupiedBeds[0].id }),
});
assert(bedConflict.status === 409, `occupied bed assignment returned ${bedConflict.status}`);
const legacyBedConflict = await request('/admissions', doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ patient_id: newPatient.id, ward: occupiedBeds[0].ward_name, bed: occupiedBeds[0].label }),
});
assert(legacyBedConflict.status === 409, `legacy occupied bed assignment returned ${legacyBedConflict.status}`);
const bedAdmission = await request('/admissions', doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ patient_id: newPatient.id, bed_id: availableBeds[0].id }),
});
assert(bedAdmission.status === 201, `available bed assignment returned ${bedAdmission.status}`);
const admittedPatient = await bedAdmission.json() as { id: string; revision: number };
assert(availableBeds.length >= 2, 'seed requires two available beds for movement test');
const movementObservation = await request(`/admissions/${admittedPatient.id}/observations`, admin.token, {
  method: 'POST', body: JSON.stringify({ bp_systolic: 90, heart_rate: 120, spo2: 90, resp_rate: 26, temperature: 39.2, on_supplemental_oxygen: true, consciousness: 'confusion' }),
});
assert(movementObservation.status === 201, `movement observation returned ${movementObservation.status}`);
const unsafeEscort = await request('/patient-movements', admin.token, {
  method: 'POST', body: JSON.stringify({ admission_id: admittedPatient.id, movement_type: 'temporary', destination_area: 'CT', reason: 'Imaging', escort: 'porter', equipment: [] }),
});
assert(unsafeEscort.status === 409, `unsafe escort returned ${unsafeEscort.status}`);
const temporaryMove = await request('/patient-movements', admin.token, {
  method: 'POST', body: JSON.stringify({ admission_id: admittedPatient.id, movement_type: 'temporary', destination_area: 'CT', reason: 'Imaging', escort: 'nurse', equipment: ['portable_monitor'] }),
});
assert(temporaryMove.status === 201, `temporary movement returned ${temporaryMove.status}`);
const temporary = await temporaryMove.json() as { id: string };
const temporaryDepart = await request(`/patient-movements/${temporary.id}/depart`, admin.token, { method: 'POST' });
assert(temporaryDepart.ok, `temporary departure returned ${temporaryDepart.status}`);
const temporaryReturn = await request(`/patient-movements/${temporary.id}/return`, admin.token, { method: 'POST' });
assert(temporaryReturn.ok, `temporary return returned ${temporaryReturn.status}`);
const permanentMove = await request('/patient-movements', admin.token, {
  method: 'POST', body: JSON.stringify({ admission_id: admittedPatient.id, movement_type: 'permanent', destination_unit_id: units[0].id, reason: 'Move bed', escort: 'nurse', equipment: [] }),
});
assert(permanentMove.status === 201, `permanent movement returned ${permanentMove.status}`);
const permanent = await permanentMove.json() as { id: string };
const reservation = await request(`/patient-movements/${permanent.id}/reserve`, admin.token, { method: 'POST', body: JSON.stringify({ bed_id: availableBeds[1].id }) });
assert(reservation.ok, `movement reservation returned ${reservation.status}`);
const reservedBedsResponse = await request('/beds?occupancy=reserved', admin.token);
const reservedBeds = await reservedBedsResponse.json() as { id: string }[];
assert(reservedBeds.some((bed) => bed.id === availableBeds[1].id), 'reserved bed missing from bed view');
const reserveBypass = await request('/admissions', doctor1.token, { method: 'POST', body: JSON.stringify({ patient_id: newPatient.id, bed_id: availableBeds[1].id }) });
assert(reserveBypass.status === 409, `reserved bed accepted a second admission (${reserveBypass.status})`);
const cancelMovement = await request(`/patient-movements/${permanent.id}/cancel`, admin.token, { method: 'POST' });
assert(cancelMovement.ok, `movement cancellation returned ${cancelMovement.status}`);
const claimResponse = await request('/claims', admin.token, {
  method: 'POST', body: JSON.stringify({ admission_id: admittedPatient.id, coverage_id: coverage.id, estimate: '10000.00', currency: 'INR' }),
});
assert(claimResponse.status === 201, `claim creation returned ${claimResponse.status}`);
let claim = await claimResponse.json() as { id: string; revision: number; status: string; approved_limit: string };
const claimAction = async (action: string, extra: Record<string, unknown> = {}) => {
  const response = await request(`/claims/${claim.id}/actions`, admin.token, {
    method: 'POST', body: JSON.stringify({ action, expected_revision: claim.revision, ...extra }),
  });
  assert(response.ok, `claim ${action} returned ${response.status}`);
  claim = await response.json() as typeof claim;
};
await claimAction('send_preauthorization');
await claimAction('raise_query', { note: 'Need admission note' });
await claimAction('reply_query', { note: 'Provided admission note' });
await claimAction('approve', { approved_limit: '15000.00' });
assert(claim.status === 'approved' && Number(claim.approved_limit) === 15000, 'claim approval or monetary precision incorrect');
const duplicateClaimAction = await request(`/claims/${claim.id}/actions`, admin.token, { method: 'POST', body: JSON.stringify({ action: 'approve', approved_limit: '15000.00', expected_revision: claim.revision - 1 }) });
assert(duplicateClaimAction.status === 409, `stale claim update returned ${duplicateClaimAction.status}`);
const unsafeBilling = await request(`/claims/${claim.id}/actions`, admin.token, { method: 'POST', body: JSON.stringify({ action: 'bill_discharge', expected_revision: claim.revision }) });
assert(unsafeBilling.status === 409, `discharge billing bypassed pending safety workflow (${unsafeBilling.status})`);
const depositResponse = await request('/claims/deposits', admin.token, { method: 'POST', body: JSON.stringify({ admission_id: admittedPatient.id, amount: '500.00', reference: 'DEMO-DEP-1' }) });
assert(depositResponse.status === 201, `deposit creation returned ${depositResponse.status}`);
const repeatedDeposit = await request('/claims/deposits', admin.token, { method: 'POST', body: JSON.stringify({ admission_id: admittedPatient.id, amount: '500.00', reference: 'DEMO-DEP-1' }) });
assert(repeatedDeposit.status === 409, `duplicate deposit returned ${repeatedDeposit.status}`);
assert(availableBeds.length >= 2, 'seed requires two available beds for move test');
const beforeBedMove = await (await request(`/admissions/${admittedPatient.id}`, admin.token)).json() as { revision: number | string };
const bedMove = await request(`/admissions/${admittedPatient.id}/bed-assignments`, admin.token, {
  method: 'POST', body: JSON.stringify({ bed_id: availableBeds[1].id, expected_revision: Number(beforeBedMove.revision) }),
});
assert(bedMove.ok, `bed move returned ${bedMove.status}`);
const cleaningBedsResponse = await request('/beds?occupancy=cleaning', admin.token);
const cleaningBeds = await cleaningBedsResponse.json() as { id: string }[];
assert(cleaningBeds.some((bed) => bed.id === availableBeds[0].id), 'vacated bed was not marked for cleaning');
const staleBedMove = await request(`/admissions/${admittedPatient.id}/bed-assignments`, admin.token, {
  method: 'POST', body: JSON.stringify({ bed_id: availableBeds[0].id, expected_revision: admittedPatient.revision }),
});
assert(staleBedMove.status === 409, `stale bed move returned ${staleBedMove.status}`);
const bedHistoryResponse = await request(`/admissions/${admittedPatient.id}/bed-history`, admin.token);
assert(bedHistoryResponse.ok, `bed history returned ${bedHistoryResponse.status}`);
const bedHistory = await bedHistoryResponse.json() as { bed_id: string; ends_at: string | null }[];
assert(bedHistory.some((entry) => entry.bed_id === availableBeds[0].id && entry.ends_at !== null), 'previous bed history not closed');
assert(bedHistory.some((entry) => entry.bed_id === availableBeds[1].id && entry.ends_at === null), 'active bed history missing');
const secondPatientResponse = await request('/patients', doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ name: 'Second Bed Conflict Test', dob: '2000-01-02' }),
});
const secondPatient = await secondPatientResponse.json() as { id: string };
const secondBedConflict = await request('/admissions', doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ patient_id: secondPatient.id, bed_id: availableBeds[1].id }),
});
assert(secondBedConflict.status === 409, `duplicate active bed assignment returned ${secondBedConflict.status}`);
for (const exit_type of [undefined, 'discharged', 'lama', 'transfer_out']) {
  const direct = await request(`/admissions/${admittedPatient.id}/discharge`, admin.token, { method: 'POST', body: JSON.stringify(exit_type ? { exit_type } : {}) });
  assert(direct.status === 409, `routine legacy discharge bypassed staging for ${exit_type ?? 'default'} (${direct.status})`);
}
const treatingAssignment = await request(`/admissions/${admittedPatient.id}/staff-assignments`, admin.token, {
  method: 'POST', body: JSON.stringify({ user_id: doctor2.user.id, assignment_type: 'treating_consultant' }),
});
assert(treatingAssignment.status === 201, `treating consultant assignment returned ${treatingAssignment.status}`);
const routineObservation = await request(`/admissions/${admittedPatient.id}/observations`, admin.token, {
  method: 'POST', body: JSON.stringify({ bp_systolic: 120, heart_rate: 75, spo2: 98, resp_rate: 16, temperature: 37, on_supplemental_oxygen: false, consciousness: 'alert' }),
});
assert(routineObservation.status === 201, `routine discharge observation returned ${routineObservation.status}`);
const insuredPlanResponse = await request('/discharge-plans', admin.token, {
  method: 'POST', body: JSON.stringify({ admission_id: admittedPatient.id, discharge_type: 'home', planned_at: new Date().toISOString(), condition: 'Stable', follow_up: 'Review in one week' }),
});
assert(insuredPlanResponse.status === 201, `insured discharge plan returned ${insuredPlanResponse.status}`);
const insuredPlan = await insuredPlanResponse.json() as { id: string };
const insuredApproval = await request(`/discharge-plans/${insuredPlan.id}/approve`, doctor2.token, { method: 'POST' });
assert(insuredApproval.ok, `insured discharge approval returned ${insuredApproval.status}`);
const insuredSummary = await request(`/discharge-plans/${insuredPlan.id}/summary`, admin.token, { method: 'POST', body: JSON.stringify({ summary: 'Demo discharge summary' }) });
assert(insuredSummary.ok, `insured discharge summary returned ${insuredSummary.status}`);
const insuredDetail = await request(`/discharge-plans/${insuredPlan.id}`, admin.token);
const insuredTasks = (await insuredDetail.json() as { tasks: { id: string; code: string }[] }).tasks;
for (const code of ['pending_results', 'medication_reconciliation', 'nursing', 'billing', 'payment']) {
  const task = insuredTasks.find((entry) => entry.code === code);
  assert(task, `insured discharge task ${code} missing`);
  const completed = await request(`/discharge-plans/tasks/${task.id}/complete`, admin.token, { method: 'POST', body: JSON.stringify({ evidence: `Demo ${code} complete` }) });
  assert(completed.ok, `insured discharge task ${code} returned ${completed.status}`);
}
const insuranceTask = insuredTasks.find((entry) => entry.code === 'insurance');
assert(insuranceTask, 'insured discharge insurance task missing');
const prematureInsurance = await request(`/discharge-plans/tasks/${insuranceTask.id}/complete`, admin.token, { method: 'POST', body: JSON.stringify({ evidence: 'Attempt before insurer approval' }) });
assert(prematureInsurance.status === 409, `insurance task bypassed final approval (${prematureInsurance.status})`);
await claimAction('bill_discharge');
await claimAction('final_approve');
const insuranceComplete = await request(`/discharge-plans/tasks/${insuranceTask.id}/complete`, admin.token, { method: 'POST', body: JSON.stringify({ evidence: 'Demo final approval recorded' }) });
assert(insuranceComplete.ok, `insured discharge insurance completion returned ${insuranceComplete.status}`);
const discharge = await request(`/discharge-plans/${insuredPlan.id}/complete`, admin.token, { method: 'POST' });
assert(discharge.ok, `staged insured discharge returned ${discharge.status}`);
const dischargedHistoryResponse = await request(`/admissions/${admittedPatient.id}/bed-history`, admin.token);
const dischargedHistory = await dischargedHistoryResponse.json() as { bed_id: string; ends_at: string | null; end_reason: string | null }[];
assert(dischargedHistory.some((entry) => entry.bed_id === availableBeds[1].id && entry.ends_at !== null && entry.end_reason === 'discharge'), 'discharge did not close bed history');

const nurseCreatePatient = await request('/patients', nurse.token, {
  method: 'POST',
  body: JSON.stringify({ name: 'Not Allowed', dob: '2000-01-01' }),
});
assert(nurseCreatePatient.status === 403, `nurse patient creation returned ${nurseCreatePatient.status}`);

const adminOnly = await request('/users', doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ name: 'Not Allowed', role: 'doctor', phone: '+19990000090' }),
});
assert(adminOnly.status === 403, `non-admin user creation returned ${adminOnly.status}`);
const pharmacistCreate = await request('/users', admin.token, {
  method: 'POST',
  body: JSON.stringify({ name: 'Test Pharmacist', role: 'admin', job_role: 'pharmacist', phone: '+44 7700 901111' }),
});
assert(pharmacistCreate.status === 201, `pharmacist creation returned ${pharmacistCreate.status}`);
const pharmacist = await login('+44 7700 901111');
const pharmacistClinicalAccess = await request(`/admissions/${doctor1Admission.id}`, pharmacist.token);
assert(pharmacistClinicalAccess.status === 403, `pharmacist received unrestricted clinical access (${pharmacistClinicalAccess.status})`);
const pharmacistAdminAccess = await request('/users', pharmacist.token, {
  method: 'POST',
  body: JSON.stringify({ name: 'Not Allowed', role: 'doctor', phone: '+19990000091' }),
});
assert(pharmacistAdminAccess.status === 403, `pharmacist received user-admin access (${pharmacistAdminAccess.status})`);

const noteResponse = await request(`/admissions/${doctor1Admission.id}/notes`, doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ kind: 'progress', draft_body: 'Scoped integration test', created_by: DOCTOR_2 }),
});
if (noteResponse.status !== 201) {
  throw new Error(`note creation returned ${noteResponse.status}: ${await noteResponse.text()}`);
}
const note = await noteResponse.json() as { created_by: string };
assert(note.created_by === DOCTOR_1, 'caller-supplied note actor was trusted');

const handoffResponse = await request(`/admissions/${doctor1Admission.id}/handoffs`, doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ reason: 'Shift change', requested_by: DOCTOR_2 }),
});
if (handoffResponse.status !== 201) {
  throw new Error(`handoff creation returned ${handoffResponse.status}: ${await handoffResponse.text()}`);
}
const handoff = await handoffResponse.json() as { requested_by: string };
assert(handoff.requested_by === DOCTOR_1, 'caller-supplied handoff actor was trusted');

const labOrderResponse = await request(`/admissions/${doctor1Admission.id}/orders`, doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ kind: 'laboratory', payload: { test: 'Complete blood count' }, priority: 'stat' }),
});
assert(labOrderResponse.status === 201, `laboratory order creation returned ${labOrderResponse.status}`);
const labOrder = await labOrderResponse.json() as { kind: string; priority: string };
assert(labOrder.kind === 'laboratory' && labOrder.priority === 'stat', 'laboratory order fields were not preserved');

const orderResponse = await request(`/admissions/${doctor1Admission.id}/orders`, doctor1.token, {
  method: 'POST',
  body: JSON.stringify({ kind: 'nursing', payload: { instruction: 'Check observations' }, priority: 'urgent' }),
});
assert(orderResponse.status === 201, `order creation returned ${orderResponse.status}`);
const order = await orderResponse.json() as { id: string; priority: string };
assert(order.priority === 'urgent', 'order priority was not preserved');
const confirmation = await request(`/orders/${order.id}/confirm`, doctor1.token, {
  method: 'POST', body: JSON.stringify({}),
});
assert(confirmation.status === 200, `order confirmation returned ${confirmation.status}: ${confirmation.status === 200 ? '' : await confirmation.text()}`);
const repeatedConfirmation = await request(`/orders/${order.id}/confirm`, doctor1.token, {
  method: 'POST', body: JSON.stringify({}),
});
assert(repeatedConfirmation.status === 404, `repeated confirmation returned ${repeatedConfirmation.status}`);
const acknowledgement = await request(`/orders/${order.id}/acknowledge`, nurse.token, { method: 'POST' });
assert(acknowledgement.status === 200, `order acknowledgement returned ${acknowledgement.status}`);
const repeatedAcknowledgement = await request(`/orders/${order.id}/acknowledge`, nurse.token, { method: 'POST' });
assert(repeatedAcknowledgement.status === 409, `repeated acknowledgement returned ${repeatedAcknowledgement.status}`);
const crossOrder = await request(`/orders/${order.id}/acknowledge`, doctor2.token, { method: 'POST' });
assert(crossOrder.status === 403, `cross-user acknowledgement returned ${crossOrder.status}`);

const worklistResponse = await request('/worklists/me', nurse.token);
assert(worklistResponse.ok, `worklist returned ${worklistResponse.status}`);
const worklist = await worklistResponse.json() as { admission_id: string; type: string }[];
assert(worklist.some((item) => item.admission_id === doctor1Admission.id && item.type === 'task'), 'nurse worklist is missing the confirmed order task');
assert(worklist.every((item) => item.admission_id !== doctor2Admission.id || nurseOpenAdmissions.some((admission) => 'id' in admission && admission.id === item.admission_id)), 'worklist leaked a non-assigned admission');
const prematureCompletion = await request(`/orders/${order.id}/complete`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ reason: 'Completed' }),
});
assert(prematureCompletion.status === 409, `completion with pending task returned ${prematureCompletion.status}`);
const discontinuation = await request(`/orders/${order.id}/discontinue`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ reason: 'No longer required' }),
});
assert(discontinuation.ok, `order discontinuation returned ${discontinuation.status}`);
const repeatedDiscontinuation = await request(`/orders/${order.id}/discontinue`, doctor1.token, {
  method: 'POST', body: JSON.stringify({ reason: 'No longer required' }),
});
assert(repeatedDiscontinuation.status === 409, `repeat discontinuation returned ${repeatedDiscontinuation.status}`);

const nurseNotificationsResponse = await request(`/notifications?user_id=${DOCTOR_1}`, nurse.token);
assert(nurseNotificationsResponse.ok, `notification list returned ${nurseNotificationsResponse.status}`);
const nurseNotifications = await nurseNotificationsResponse.json() as { id: string; type: string; user_id: string }[];
assert(
  nurseNotifications.some((notification) => notification.type === 'handoff.created' && notification.user_id === nurse.user.id),
  'notification query escaped authenticated user scope'
);
const notification = nurseNotifications.find((item) => item.type === 'handoff.created');
assert(notification, 'handoff notification missing');
const wrongNotification = await request(`/notifications/${notification.id}/acknowledge`, doctor1.token, { method: 'POST' });
assert(wrongNotification.status === 404, `cross-user notification acknowledgement returned ${wrongNotification.status}`);
const acknowledgedNotification = await request(`/notifications/${notification.id}/acknowledge`, nurse.token, { method: 'POST' });
assert(acknowledgedNotification.ok, `notification acknowledgement returned ${acknowledgedNotification.status}`);
const closedNotification = await request(`/notifications/${notification.id}/close`, nurse.token, { method: 'POST' });
assert(closedNotification.ok, `notification closure returned ${closedNotification.status}`);

const consultantCreate = await request('/users', admin.token, {
  method: 'POST', body: JSON.stringify({ name: 'Transfer Consultant', role: 'doctor', job_role: 'consultant', phone: '+44 7700 901222' }),
});
assert(consultantCreate.status === 201, `consultant creation returned ${consultantCreate.status}`);
const receivingConsultant = await login('+44 7700 901222');
const careTransferResponse = await request('/consultant-care-transfers', doctor2.token, {
  method: 'POST', body: JSON.stringify({ admission_id: doctor2Admission.id, to_consultant_id: receivingConsultant.user.id, reason: 'Specialist care', discussed_with_current: true, patient_family_informed: true }),
});
assert(careTransferResponse.status === 201, `care transfer request returned ${careTransferResponse.status}`);
const careTransfer = await careTransferResponse.json() as { id: string };
const prematureCareAcceptance = await request(`/consultant-care-transfers/${careTransfer.id}/accept`, receivingConsultant.token, { method: 'POST' });
assert(prematureCareAcceptance.status === 409, `care transfer accepted before release (${prematureCareAcceptance.status})`);
const careRelease = await request(`/consultant-care-transfers/${careTransfer.id}/release`, doctor2.token, { method: 'POST' });
assert(careRelease.ok, `care release returned ${careRelease.status}`);
const careAccept = await request(`/consultant-care-transfers/${careTransfer.id}/accept`, receivingConsultant.token, { method: 'POST' });
assert(careAccept.ok, `care acceptance returned ${careAccept.status}`);
const receivingPatient = await request(`/patients/${doctor2Admission.patient_id}`, receivingConsultant.token);
assert(receivingPatient.ok, `receiving consultant patient access returned ${receivingPatient.status}`);
const receivingWorklist = await request('/consultant-rounds/worklist', receivingConsultant.token);
const receivingPatients = await receivingWorklist.json() as { admission_id: string }[];
assert(receivingPatients.some((patient) => patient.admission_id === doctor2Admission.id), 'transferred patient missing from consultant worklist');
const declineRequestResponse = await request('/consultant-care-transfers', receivingConsultant.token, {
  method: 'POST', body: JSON.stringify({ admission_id: doctor2Admission.id, to_consultant_id: doctor2.user.id, reason: 'Return care', discussed_with_current: true, patient_family_informed: true }),
});
assert(declineRequestResponse.status === 201, `decline-path request returned ${declineRequestResponse.status}`);
const declineRequest = await declineRequestResponse.json() as { id: string };
const declineRelease = await request(`/consultant-care-transfers/${declineRequest.id}/release`, receivingConsultant.token, { method: 'POST' });
assert(declineRelease.ok, `decline-path release returned ${declineRelease.status}`);
const missingDeclineReason = await request(`/consultant-care-transfers/${declineRequest.id}/decline`, doctor2.token, { method: 'POST', body: JSON.stringify({}) });
assert(missingDeclineReason.status === 400, `missing decline reason returned ${missingDeclineReason.status}`);
const declinedCare = await request(`/consultant-care-transfers/${declineRequest.id}/decline`, doctor2.token, {
  method: 'POST', body: JSON.stringify({ reason: 'Unable to accept care' }),
});
assert(declinedCare.ok, `care decline returned ${declinedCare.status}`);
const withdrawRequestResponse = await request('/consultant-care-transfers', receivingConsultant.token, {
  method: 'POST', body: JSON.stringify({ admission_id: doctor2Admission.id, to_consultant_id: doctor2.user.id, reason: 'Return care', discussed_with_current: true, patient_family_informed: true }),
});
assert(withdrawRequestResponse.status === 201, `withdraw-path request returned ${withdrawRequestResponse.status}`);
const withdrawRequest = await withdrawRequestResponse.json() as { id: string };
const withdrawnCare = await request(`/consultant-care-transfers/${withdrawRequest.id}/withdraw`, receivingConsultant.token, { method: 'POST' });
assert(withdrawnCare.ok, `care withdrawal returned ${withdrawnCare.status}`);
const transferAdmissionResponse = await request(`/admissions/${doctor2Admission.id}`, doctor2.token);
const transferAdmission = await transferAdmissionResponse.json() as { revision: number | string };
const transferResponse = await request(`/admissions/${doctor2Admission.id}/transfer-doctor`, doctor2.token, {
  method: 'POST', body: JSON.stringify({ to_doctor_id: doctor3.user.id, expected_revision: Number(transferAdmission.revision), message: 'Coverage' }),
});
assert(transferResponse.status === 201, `transfer request returned ${transferResponse.status}`);
const transfer = await transferResponse.json() as { id: string };
const acceptedTransfer = await request(`/transfer-requests/${transfer.id}/accept`, doctor3.token, { method: 'POST' });
assert(acceptedTransfer.ok, `transfer acceptance returned ${acceptedTransfer.status}`);
const repeatedTransfer = await request(`/transfer-requests/${transfer.id}/accept`, doctor3.token, { method: 'POST' });
assert(repeatedTransfer.status === 409, `repeated transfer acceptance returned ${repeatedTransfer.status}`);
const previousDoctorAccess = await request(`/admissions/${doctor2Admission.id}`, doctor2.token);
assert(previousDoctorAccess.status === 403, `previous doctor retained access after transfer (${previousDoctorAccess.status})`);

const intakePatientResponse = await request('/patients', admin.token, { method: 'POST', body: JSON.stringify({ name: 'Admission intake demo', dob: '1990-01-01' }) });
assert(intakePatientResponse.status === 201, `intake patient creation returned ${intakePatientResponse.status}`);
const intakePatient = await intakePatientResponse.json() as { id: string };
const intakeRequestResponse = await request('/admission-requests', admin.token, {
  method: 'POST', body: JSON.stringify({ patient_id: intakePatient.id, source: 'emergency', diagnosis: 'Demo diagnosis', clinical_handover: 'Demo handover', requested_unit_id: units[0].id }),
});
assert(intakeRequestResponse.status === 201, `admission request returned ${intakeRequestResponse.status}`);
const intakeRequest = await intakeRequestResponse.json() as { id: string };
const intakeBedsResponse = await request('/beds?occupancy=available', admin.token);
const intakeBeds = (await intakeBedsResponse.json() as { id: string; ward_id: string }[]).filter((bed) => unitWardIds.has(bed.ward_id));
assert(intakeBeds.length, 'admission intake requires a free bed');
const intakeAccept = await request(`/admission-requests/${intakeRequest.id}/accept`, admin.token, {
  method: 'POST', body: JSON.stringify({ bed_id: intakeBeds[0].id, consultant_id: doctor2.user.id, duty_doctor_id: doctor3.user.id }),
});
assert(intakeAccept.status === 201, `admission request acceptance returned ${intakeAccept.status}`);
const intakeResult = await intakeAccept.json() as { admission: { id: string } };
const repeatedIntake = await request(`/admission-requests/${intakeRequest.id}/accept`, admin.token, {
  method: 'POST', body: JSON.stringify({ bed_id: intakeBeds[0].id, consultant_id: doctor2.user.id, duty_doctor_id: doctor3.user.id }),
});
assert(repeatedIntake.status === 409, `repeat admission acceptance returned ${repeatedIntake.status}`);
const admissionChecklistResponse = await request(`/admissions/${intakeResult.admission.id}/admission-checklist`, admin.token);
const admissionChecklist = await admissionChecklistResponse.json() as { id: string; code: string }[];
assert(admissionChecklist.length === 8, 'admission checklist missing steps');
const bedsideAssignment = await request(`/admissions/${intakeResult.admission.id}/take-nursing-assignment`, nurse.token, { method: 'POST' });
assert(bedsideAssignment.ok, `new admission bedside assignment returned ${bedsideAssignment.status}`);
const duplicateBedsideAssignment = await request(`/admissions/${intakeResult.admission.id}/take-nursing-assignment`, nurse.token, { method: 'POST' });
assert(duplicateBedsideAssignment.status === 409, `repeat bedside assignment returned ${duplicateBedsideAssignment.status}`);
const registrationItem = admissionChecklist.find((item) => item.code === 'registration_consent');
assert(registrationItem, 'registration checklist item missing');
const checklistComplete = await request(`/admission-checklist/${registrationItem.id}/complete`, admin.token, { method: 'POST', body: JSON.stringify({ evidence: 'Demo registration' }) });
assert(checklistComplete.ok, `admission checklist completion returned ${checklistComplete.status}`);
const emptyVitals = await request(`/admissions/${intakeResult.admission.id}/vitals`, admin.token, { method: 'POST', body: '{}' });
assert(emptyVitals.status === 400, `empty vitals returned ${emptyVitals.status}`);
const invalidVitals = await request(`/admissions/${intakeResult.admission.id}/vitals`, admin.token, { method: 'POST', body: JSON.stringify({ heart_rate: -1 }) });
assert(invalidVitals.status === 400, `invalid vitals returned ${invalidVitals.status}`);
const invalidBloodPressure = await request(`/admissions/${intakeResult.admission.id}/observations`, admin.token, {
  method: 'POST', body: JSON.stringify({ bp_systolic: 100, bp_diastolic: 110, heart_rate: 75, spo2: 98, resp_rate: 16, temperature: 37, on_supplemental_oxygen: false, consciousness: 'alert' }),
});
assert(invalidBloodPressure.status === 400, `invalid blood pressure returned ${invalidBloodPressure.status}`);
const highDischargeVitals = await request(`/admissions/${intakeResult.admission.id}/observations`, admin.token, {
  method: 'POST', body: JSON.stringify({ bp_systolic: 90, heart_rate: 120, spo2: 90, resp_rate: 26, temperature: 39.2, on_supplemental_oxygen: true, consciousness: 'confusion' }),
});
assert(highDischargeVitals.status === 201, `high discharge observation returned ${highDischargeVitals.status}`);
const highNewsAlerts = await request(`/admissions/${intakeResult.admission.id}/alerts?status=active`, admin.token);
const highNewsAlertRows = await highNewsAlerts.json() as { type: string; message: string }[];
assert(highNewsAlertRows.some((alert) => alert.type === 'news2' && alert.message.includes('continuous monitoring')), 'high NEWS2 escalation instructions missing');
const unsafeObservationInterval = await request(`/admissions/${intakeResult.admission.id}/observation-schedule`, admin.token, {
  method: 'PATCH', body: JSON.stringify({ frequency_minutes: 720, reason: 'Test unsafe interval' }),
});
assert(unsafeObservationInterval.status === 409, `high NEWS2 accepted unsafe observation interval (${unsafeObservationInterval.status})`);
const safeObservationInterval = await request(`/admissions/${intakeResult.admission.id}/observation-schedule`, admin.token, {
  method: 'PATCH', body: JSON.stringify({ frequency_minutes: 5, reason: 'Enhanced monitoring' }),
});
assert(safeObservationInterval.ok, `safe observation interval returned ${safeObservationInterval.status}`);
const dischargePlanResponse = await request('/discharge-plans', admin.token, {
  method: 'POST', body: JSON.stringify({ admission_id: intakeResult.admission.id, discharge_type: 'home', planned_at: new Date().toISOString(), condition: 'Stable', follow_up: 'Review in one week' }),
});
assert(dischargePlanResponse.status === 201, `discharge plan creation returned ${dischargePlanResponse.status}`);
const dischargePlan = await dischargePlanResponse.json() as { id: string };
const unstableApproval = await request(`/discharge-plans/${dischargePlan.id}/approve`, doctor2.token, { method: 'POST' });
assert(unstableApproval.status === 409, `unstable home discharge approval returned ${unstableApproval.status}`);
const directDischarge = await request(`/admissions/${intakeResult.admission.id}/discharge`, admin.token, { method: 'POST', body: '{}' });
assert(!directDischarge.ok, `direct discharge bypassed an open staged plan (${directDischarge.status})`);
const safeDischargeVitals = await request(`/admissions/${intakeResult.admission.id}/observations`, admin.token, {
  method: 'POST', body: JSON.stringify({ bp_systolic: 120, heart_rate: 75, spo2: 98, resp_rate: 16, temperature: 37, on_supplemental_oxygen: false, consciousness: 'alert' }),
});
assert(safeDischargeVitals.status === 201, `safe discharge observation returned ${safeDischargeVitals.status}`);
const concurrentObservations = await Promise.all([
  { bp_systolic: 90, heart_rate: 120, spo2: 90, resp_rate: 26, temperature: 39.2, on_supplemental_oxygen: true, consciousness: 'confusion' },
  { bp_systolic: 120, heart_rate: 75, spo2: 98, resp_rate: 16, temperature: 37, on_supplemental_oxygen: false, consciousness: 'alert' },
].map((body) => request(`/admissions/${intakeResult.admission.id}/observations`, admin.token, { method: 'POST', body: JSON.stringify(body) })));
assert(concurrentObservations.every((response) => response.status === 201), 'concurrent observations were not recorded');
const concurrentLatestResponse = await request(`/admissions/${intakeResult.admission.id}/news2/latest`, admin.token);
const concurrentLatest = await concurrentLatestResponse.json() as { news2_score: number };
const concurrentAlertsResponse = await request(`/admissions/${intakeResult.admission.id}/alerts?status=active`, admin.token);
const concurrentAlerts = await concurrentAlertsResponse.json() as { type: string }[];
const activeNewsAlerts = concurrentAlerts.filter((alert) => alert.type === 'news2');
assert(activeNewsAlerts.length === (concurrentLatest.news2_score >= 5 ? 1 : 0), 'concurrent observations left stale NEWS2 alerts');
const restoreSafeObservation = await request(`/admissions/${intakeResult.admission.id}/observations`, admin.token, {
  method: 'POST', body: JSON.stringify({ bp_systolic: 120, heart_rate: 75, spo2: 98, resp_rate: 16, temperature: 37, on_supplemental_oxygen: false, consciousness: 'alert' }),
});
assert(restoreSafeObservation.status === 201, `restoring safe observation returned ${restoreSafeObservation.status}`);
const dischargeApprove = await request(`/discharge-plans/${dischargePlan.id}/approve`, doctor2.token, { method: 'POST' });
assert(dischargeApprove.ok, `discharge approval returned ${dischargeApprove.status}`);
const dischargeEarly = await request(`/discharge-plans/${dischargePlan.id}/complete`, admin.token, { method: 'POST' });
assert(dischargeEarly.status === 409, `discharge bypassed checklist (${dischargeEarly.status})`);
const dischargeSummary = await request(`/discharge-plans/${dischargePlan.id}/summary`, admin.token, { method: 'POST', body: JSON.stringify({ summary: 'Demo discharge summary' }) });
assert(dischargeSummary.ok, `discharge summary returned ${dischargeSummary.status}`);
const dischargeDetailResponse = await request(`/discharge-plans/${dischargePlan.id}`, admin.token);
const dischargeDetail = await dischargeDetailResponse.json() as { tasks: { id: string; code: string }[] };
for (const code of ['pending_results','medication_reconciliation','nursing','billing','payment']) {
  const task = dischargeDetail.tasks.find((entry) => entry.code === code);
  assert(task, `discharge ${code} task missing`);
  const completed = await request(`/discharge-plans/tasks/${task.id}/complete`, admin.token, { method: 'POST', body: JSON.stringify({ evidence: `Demo ${code} complete` }) });
  assert(completed.ok, `discharge ${code} returned ${completed.status}`);
}
const stagedDischarge = await request(`/discharge-plans/${dischargePlan.id}/complete`, admin.token, { method: 'POST' });
assert(stagedDischarge.ok, `staged discharge returned ${stagedDischarge.status}`);
const postDischargeObservation = await request(`/admissions/${intakeResult.admission.id}/observations`, admin.token, {
  method: 'POST', body: JSON.stringify({ bp_systolic: 120, heart_rate: 75, spo2: 98, resp_rate: 16, temperature: 37, on_supplemental_oxygen: false, consciousness: 'alert' }),
});
assert(postDischargeObservation.status === 409, `observation recorded after discharge (${postDischargeObservation.status})`);
const postDischargeVitals = await request(`/admissions/${intakeResult.admission.id}/vitals`, admin.token, { method: 'POST', body: JSON.stringify({ heart_rate: 75 }) });
assert(postDischargeVitals.status === 409, `partial vitals recorded after discharge (${postDischargeVitals.status})`);

const ipassAdmissionResponse = await request(`/admissions/${doctor1Admission.id}`, doctor1.token);
const ipassAdmission = await ipassAdmissionResponse.json() as { revision: number | string };
const makeUnstable = await request(`/admissions/${doctor1Admission.id}`, doctor1.token, {
  method: 'PATCH', body: JSON.stringify({ expected_revision: Number(ipassAdmission.revision), severity: 'unstable' }),
});
assert(makeUnstable.ok, `setting unstable severity returned ${makeUnstable.status}`);
const ipassCreate = await request('/ipass', doctor1.token, { method: 'POST', body: JSON.stringify({ incoming_doctor_id: doctor3.user.id }) });
assert(ipassCreate.status === 201, `I-PASS draft returned ${ipassCreate.status}`);
const ipass = await ipassCreate.json() as { session: { id: string }; items: { id: string; admission_id: string }[] };
assert(ipass.items.length > 0, 'I-PASS draft has no patients');
const earlySend = await request(`/ipass/${ipass.session.id}/send`, doctor1.token, { method: 'POST' });
assert(earlySend.status === 409, `unsigned I-PASS sent (${earlySend.status})`);
for (const item of ipass.items) {
  const edit = await request(`/ipass/items/${item.id}`, doctor1.token, { method: 'PATCH', body: JSON.stringify({ patient_summary: 'Patient summary', action_list: 'Continue monitoring', contingency: 'Escalate deterioration' }) });
  assert(edit.ok, `I-PASS edit returned ${edit.status}`);
  const sign = await request(`/ipass/items/${item.id}/sign`, doctor1.token, { method: 'POST' });
  assert(sign.ok, `I-PASS sign returned ${sign.status}`);
}
const ipassSend = await request(`/ipass/${ipass.session.id}/send`, doctor1.token, { method: 'POST' });
assert(ipassSend.ok, `I-PASS send returned ${ipassSend.status}`);
const unstableItem = ipass.items.find((item) => item.admission_id === doctor1Admission.id);
assert(unstableItem, 'unstable patient missing from I-PASS');
const question = await request(`/ipass/items/${unstableItem.id}/questions`, doctor3.token, { method: 'POST', body: JSON.stringify({ body: 'What is the next action?' }) });
assert(question.status === 201, `I-PASS question returned ${question.status}`);
const questions = await request(`/ipass/items/${unstableItem.id}/questions`, doctor1.token);
assert(questions.ok && (await questions.json() as unknown[]).length === 1, 'I-PASS question history missing');
const missingReadback = await request(`/ipass/items/${unstableItem.id}/accept`, doctor3.token, { method: 'POST', body: '{}' });
assert(missingReadback.status === 409, `unstable patient accepted without read-back (${missingReadback.status})`);
const acceptedIpass = await request(`/ipass/items/${unstableItem.id}/accept`, doctor3.token, { method: 'POST', body: JSON.stringify({ readback: 'Monitor and escalate deterioration' }) });
assert(acceptedIpass.ok, `I-PASS acceptance returned ${acceptedIpass.status}`);
const repeatedIpass = await request(`/ipass/items/${unstableItem.id}/accept`, doctor3.token, { method: 'POST', body: JSON.stringify({ readback: 'Retry' }) });
assert(repeatedIpass.status === 409, `repeat I-PASS acceptance returned ${repeatedIpass.status}`);
const cancelIpass = await request(`/ipass/${ipass.session.id}/cancel`, doctor1.token, { method: 'POST' });
assert(cancelIpass.ok, `I-PASS cancellation returned ${cancelIpass.status}`);

const nurseCreate = await request('/users', admin.token, {
  method: 'POST', body: JSON.stringify({ name: 'Receiving Nurse', role: 'nurse', job_role: 'staff_nurse', phone: '+44 7700 901333' }),
});
assert(nurseCreate.status === 201, `receiving nurse creation returned ${nurseCreate.status}`);
const receivingNurse = await login('+44 7700 901333');
const bedsideCreate = await request('/nurse-handover', nurse.token, { method: 'POST', body: JSON.stringify({ incoming_nurse_id: receivingNurse.user.id }) });
assert(bedsideCreate.status === 201, `bedside handover creation returned ${bedsideCreate.status}`);
const bedside = await bedsideCreate.json() as { session: { id: string }; items: { id: string; admission_id: string; snapshot: Record<string, unknown> }[] };
const bedsideItem = bedside.items.find((item) => item.admission_id === doctor1Admission.id);
assert(bedsideItem && bedsideItem.snapshot.latest_assessment, 'bedside handover missing patient assessment');
const bedsideSend = await request(`/nurse-handover/${bedside.session.id}/send`, nurse.token, { method: 'POST' });
assert(bedsideSend.ok, `bedside send returned ${bedsideSend.status}`);
const missingBedsideChecks = await request(`/nurse-handover/items/${bedsideItem.id}/accept`, receivingNurse.token, { method: 'POST', body: JSON.stringify({ checklist: {} }) });
assert(missingBedsideChecks.status === 400, `bedside accepted without checklist (${missingBedsideChecks.status})`);
const bedsideQuestion = await request(`/nurse-handover/items/${bedsideItem.id}/questions`, receivingNurse.token, { method: 'POST', body: JSON.stringify({ body: 'Any concerns?' }) });
assert(bedsideQuestion.status === 201, `bedside question returned ${bedsideQuestion.status}`);
const bedsideQuestions = await request(`/nurse-handover/items/${bedsideItem.id}/questions`, nurse.token);
assert(bedsideQuestions.ok && (await bedsideQuestions.json() as unknown[]).length === 1, 'bedside question history missing');
const checklist = { identity_band: true, allergy_band: true, pump_rates: true, lines_and_drains: true, airway_checked_or_not_applicable: true, alarms: true, oxygen_and_suction: true, fall_precautions: true, pressure_areas: true };
const bedsideAccept = await request(`/nurse-handover/items/${bedsideItem.id}/accept`, receivingNurse.token, { method: 'POST', body: JSON.stringify({ checklist, discrepancies: '' }) });
assert(bedsideAccept.ok, `bedside acceptance returned ${bedsideAccept.status}`);
const bedsideRepeat = await request(`/nurse-handover/items/${bedsideItem.id}/accept`, receivingNurse.token, { method: 'POST', body: JSON.stringify({ checklist }) });
assert(bedsideRepeat.status === 409, `repeat bedside acceptance returned ${bedsideRepeat.status}`);
const nurseAssignment = await request(`/admissions/${doctor1Admission.id}`, receivingNurse.token);
assert(nurseAssignment.ok, `receiving nurse assignment returned ${nurseAssignment.status}`);
const bedsideCancel = await request(`/nurse-handover/${bedside.session.id}/cancel`, nurse.token, { method: 'POST' });
assert(bedsideCancel.ok, `bedside cancellation returned ${bedsideCancel.status}`);
const receivingNurseUnits = await request(`/staff/${receivingNurse.user.id}/units`, admin.token, { method: 'PUT', body: JSON.stringify({ units: [{ unit_id: units[0].id, is_primary: true }] }) });
assert(receivingNurseUnits.ok, `receiving nurse unit membership returned ${receivingNurseUnits.status}`);
const concurrentAssignments = await Promise.all([nurse.user.id, receivingNurse.user.id].map((nurse_id) => request(`/admissions/${doctor1Admission.id}/assign`, admin.token, { method: 'POST', body: JSON.stringify({ nurse_id }) })));
assert(concurrentAssignments.every((response) => response.ok), 'concurrent nurse assignments failed');
const finalAssignmentResponse = await request(`/admissions/${doctor1Admission.id}`, admin.token);
const finalAssignment = await finalAssignmentResponse.json() as { assigned_to: string };
const staffAssignmentsResponse = await request(`/admissions/${doctor1Admission.id}/staff-assignments`, admin.token);
const staffAssignments = await staffAssignmentsResponse.json() as { assignment_type: string; user_id: string }[];
const primaryNurses = staffAssignments.filter((assignment) => assignment.assignment_type === 'primary_nurse');
assert(primaryNurses.length === 1 && primaryNurses[0].user_id === finalAssignment.assigned_to, 'concurrent nurse assignment left inconsistent responsibility');
const reassignNurse = await request(`/admissions/${doctor1Admission.id}/assign`, admin.token, { method: 'POST', body: JSON.stringify({ nurse_id: nurse.user.id }) });
assert(reassignNurse.ok, `nurse reassignment returned ${reassignNurse.status}`);
const previousNurseAccess = await request(`/admissions/${doctor1Admission.id}`, receivingNurse.token);
assert(previousNurseAccess.status === 403, `previous nurse retained patient access after reassignment (${previousNurseAccess.status})`);
const unassignNurse = await request(`/admissions/${doctor1Admission.id}/unassign`, admin.token, { method: 'POST' });
assert(unassignNurse.ok, `nurse unassignment returned ${unassignNurse.status}`);
const unassignedNurseAccess = await request(`/admissions/${doctor1Admission.id}`, nurse.token);
assert(unassignedNurseAccess.status === 403, `nurse retained patient access after unassignment (${unassignedNurseAccess.status})`);

// This fixture is written only to the isolated integration-test database.
const fixtureDb = postgres(process.env.DATABASE_URL!);
const [department] = await fixtureDb<{ id: string }[]>`SELECT id FROM organization.departments ORDER BY id LIMIT 1`;
const [otherUnit] = await fixtureDb<{ id: string }[]>`INSERT INTO organization.units (department_id, code, name) VALUES (${department.id}, 'TEST-SCOPE', 'Scope Test Unit') RETURNING id`;
const [otherWard] = await fixtureDb<{ id: string }[]>`INSERT INTO organization.wards (unit_id, name) VALUES (${otherUnit.id}, 'Scope Test Ward') RETURNING id`;
const [otherRoom] = await fixtureDb<{ id: string }[]>`INSERT INTO organization.rooms (ward_id, name) VALUES (${otherWard.id}, 'Scope Test Room') RETURNING id`;
const [otherBed] = await fixtureDb<{ id: string }[]>`INSERT INTO organization.beds (room_id, label) VALUES (${otherRoom.id}, 'SCOPE-1') RETURNING id`;
const raceBeds = await fixtureDb<{ id: string; label: string }[]>`INSERT INTO organization.beds (room_id, label) VALUES (${otherRoom.id}, 'SCOPE-2'), (${otherRoom.id}, 'SCOPE-3'), (${otherRoom.id}, 'SCOPE-4') RETURNING id, label`;
const [unrelatedHistory] = await fixtureDb<{ id: string }[]>`
  INSERT INTO clinical.admissions (patient_id, status, admitted_at, discharged_at, assigned_doctor_id, created_by)
  VALUES (${doctor1Admission.patient_id}, 'discharged', now() - interval '2 days', now() - interval '1 day', ${doctor2.user.id}, ${admin.user.id}) RETURNING id
`;
await fixtureDb`INSERT INTO clinical.patients (name, dob, created_by) SELECT 'A Bed Conflict Test', '2000-01-01'::date, ${admin.user.id} FROM generate_series(1, 25)`;
await fixtureDb.end();
const scopedDuplicatesResponse = await request('/patients/duplicate-candidates', doctor1.token, {
  method: 'POST', body: JSON.stringify({ name: 'Bed Conflict Test', dob: '2000-01-01' }),
});
const scopedDuplicates = await scopedDuplicatesResponse.json() as { id: string }[];
assert(scopedDuplicatesResponse.ok && scopedDuplicates.some((patient) => patient.id === newPatient.id), 'out-of-scope duplicate candidates hid an accessible match');
const scopedHistoryResponse = await request(`/patients/${doctor1Admission.patient_id}/admissions`, doctor3.token);
assert(scopedHistoryResponse.ok, `scoped admission history returned ${scopedHistoryResponse.status}`);
const scopedHistory = await scopedHistoryResponse.json() as { id: string }[];
assert(scopedHistory.some((admission) => admission.id === doctor1Admission.id) && !scopedHistory.some((admission) => admission.id === unrelatedHistory.id), 'admission history leaked an unrelated admission');
const otherPatientResponse = await request('/patients', admin.token, { method: 'POST', body: JSON.stringify({ name: 'Cross unit fixture', dob: '1992-01-01' }) });
assert(otherPatientResponse.status === 201, `cross-unit patient creation returned ${otherPatientResponse.status}`);
const otherPatient = await otherPatientResponse.json() as { id: string; uhid: string };
const otherAdmissionResponse = await request('/admissions', admin.token, { method: 'POST', body: JSON.stringify({ patient_id: otherPatient.id, bed_id: otherBed.id }) });
assert(otherAdmissionResponse.status === 201, `cross-unit admission returned ${otherAdmissionResponse.status}`);
const otherAdmission = await otherAdmissionResponse.json() as { id: string };
const orderingDb = postgres(process.env.DATABASE_URL!);
const tiedTimestamp = new Date().toISOString();
const tiedVitals = await orderingDb<{ id: string; news2_score: number }[]>`
  INSERT INTO clinical.vitals (admission_id, recorded_by, recorded_at, news2_score, news2_escalation, news2_component_scores, news2_rule_version)
  VALUES (${otherAdmission.id}, ${admin.user.id}, ${tiedTimestamp}::timestamptz, 7, 'high', '{}'::jsonb, 'test'),
         (${otherAdmission.id}, ${admin.user.id}, ${tiedTimestamp}::timestamptz, 0, 'low', '{}'::jsonb, 'test')
  RETURNING id, news2_score
`;
await orderingDb.end();
const tiedLatestResponse = await request(`/admissions/${otherAdmission.id}/news2/latest`, admin.token);
const tiedLatest = await tiedLatestResponse.json() as { observation_id: string; news2_score: number };
assert(tiedLatest.observation_id === tiedVitals[1].id && tiedLatest.news2_score === 0, 'equal-timestamp observations are not ordered deterministically');
const otherCensusResponse = await request(`/wards/${otherWard.id}/census`, doctor1.token);
const otherCensus = await otherCensusResponse.json() as { admission_id: string }[];
assert(!otherCensus.some((entry) => entry.admission_id === otherAdmission.id), 'ward census exposed unassigned patient outside active shift unit');
const crossUnitNurseAssign = await request(`/admissions/${otherAdmission.id}/assign`, admin.token, { method: 'POST', body: JSON.stringify({ nurse_id: nurse.user.id }) });
assert(crossUnitNurseAssign.status === 404, `nurse was assigned outside unit membership (${crossUnitNurseAssign.status})`);
const bedDeskCreate = await request('/users', admin.token, { method: 'POST', body: JSON.stringify({ name: 'Scoped Bed Desk', role: 'admin', job_role: 'bed_desk', phone: '+44 7700 901444' }) });
assert(bedDeskCreate.status === 201, `bed-desk creation returned ${bedDeskCreate.status}`);
const bedDesk = await login('+44 7700 901444');
const bedDeskMembership = await request(`/staff/${bedDesk.user.id}/units`, admin.token, { method: 'PUT', body: JSON.stringify({ units: [{ unit_id: otherUnit.id, is_primary: true }] }) });
assert(bedDeskMembership.ok, `bed-desk unit assignment returned ${bedDeskMembership.status}`);
const bedDeskSearch = await request(`/patients/search?q=${encodeURIComponent(otherPatient.uhid)}`, bedDesk.token);
assert((await bedDeskSearch.json() as { id: string }[]).some((patient) => patient.id === otherPatient.id), 'bed desk cannot find patient in assigned unit');
const crossUnitSearch = await request(`/patients/search?q=${encodeURIComponent(medicationPatient.uhid)}`, bedDesk.token);
assert(!(await crossUnitSearch.json() as { id: string }[]).some((patient) => patient.id === doctor1Admission.patient_id), 'bed desk search leaked patient from another unit');
const removeBedDeskMembership = await request(`/staff/${bedDesk.user.id}/units`, admin.token, { method: 'PUT', body: JSON.stringify({ units: [] }) });
assert(removeBedDeskMembership.ok, `bed-desk membership removal returned ${removeBedDeskMembership.status}`);
const revokedBedDeskPatient = await request(`/patients/${otherPatient.id}`, bedDesk.token);
assert(revokedBedDeskPatient.status === 403, `bed desk retained patient access after unit removal (${revokedBedDeskPatient.status})`);
const shiftDoctorCreate = await request('/users', admin.token, { method: 'POST', body: JSON.stringify({ name: 'Scoped Shift Doctor', role: 'doctor', job_role: 'duty_doctor', phone: '+44 7700 901555' }) });
assert(shiftDoctorCreate.status === 201, `shift doctor creation returned ${shiftDoctorCreate.status}`);
const shiftDoctor = await login('+44 7700 901555');
const shiftMembership = await request(`/staff/${shiftDoctor.user.id}/units`, admin.token, { method: 'PUT', body: JSON.stringify({ units: [{ unit_id: otherUnit.id, is_primary: true }] }) });
assert(shiftMembership.ok, `shift doctor membership returned ${shiftMembership.status}`);
const shiftResponse = await request('/shifts', admin.token, {
  method: 'POST', body: JSON.stringify({ user_id: shiftDoctor.user.id, starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), unit_ids: [otherUnit.id] }),
});
assert(shiftResponse.status === 201, `shift creation returned ${shiftResponse.status}`);
const shift = await shiftResponse.json() as { id: string };
const activateShift = await request(`/shifts/${shift.id}/active`, shiftDoctor.token, { method: 'POST' });
assert(activateShift.ok, `shift activation returned ${activateShift.status}`);
const shiftPatient = await request(`/patients/${otherPatient.id}`, shiftDoctor.token);
assert(shiftPatient.ok, `active unit doctor patient access returned ${shiftPatient.status}`);
const shiftCensusResponse = await request(`/wards/${otherWard.id}/census`, shiftDoctor.token);
assert((await shiftCensusResponse.json() as { admission_id: string }[]).some((entry) => entry.admission_id === otherAdmission.id), 'active unit doctor cannot see unassigned patient');
const removeShiftMembership = await request(`/staff/${shiftDoctor.user.id}/units`, admin.token, { method: 'PUT', body: JSON.stringify({ units: [] }) });
assert(removeShiftMembership.ok, `shift membership removal returned ${removeShiftMembership.status}`);
const revokedShiftPatient = await request(`/patients/${otherPatient.id}`, shiftDoctor.token);
assert(revokedShiftPatient.status === 403, `doctor retained unassigned patient access after unit removal (${revokedShiftPatient.status})`);
const revokedOpenAdmissions = await request('/admissions?scope=open', shiftDoctor.token);
assert(!(await revokedOpenAdmissions.json() as { id: string }[]).some((entry) => entry.id === otherAdmission.id), 'open census ignored revoked unit membership');
const raceSources = raceBeds.filter((bed) => bed.label !== 'SCOPE-4');
const raceDestination = raceBeds.find((bed) => bed.label === 'SCOPE-4');
assert(raceSources.length === 2 && raceDestination, 'bed-reservation race fixture missing');
const raceMovements: string[] = [];
for (const [index, bed] of raceSources.entries()) {
  const patientResponse = await request('/patients', admin.token, { method: 'POST', body: JSON.stringify({ name: `Bed race patient ${index}`, dob: '1990-01-01' }) });
  const patient = await patientResponse.json() as { id: string };
  const admissionResponse = await request('/admissions', admin.token, { method: 'POST', body: JSON.stringify({ patient_id: patient.id, bed_id: bed.id }) });
  assert(admissionResponse.status === 201, `bed race admission returned ${admissionResponse.status}`);
  const admission = await admissionResponse.json() as { id: string };
  const observation = await request(`/admissions/${admission.id}/observations`, admin.token, { method: 'POST', body: JSON.stringify({ bp_systolic: 120, heart_rate: 75, spo2: 98, resp_rate: 16, temperature: 37, on_supplemental_oxygen: false, consciousness: 'alert' }) });
  assert(observation.status === 201, `bed race observation returned ${observation.status}`);
  const movement = await request('/patient-movements', admin.token, { method: 'POST', body: JSON.stringify({ admission_id: admission.id, movement_type: 'permanent', destination_unit_id: otherUnit.id, reason: 'Bed race test', escort: 'nurse', equipment: [] }) });
  assert(movement.status === 201, `bed race movement returned ${movement.status}`);
  raceMovements.push((await movement.json() as { id: string }).id);
}
const competingReservations = await Promise.all(raceMovements.map((id) => request(`/patient-movements/${id}/reserve`, admin.token, { method: 'POST', body: JSON.stringify({ bed_id: raceDestination.id }) })));
assert(competingReservations.filter((response) => response.status === 200).length === 1 && competingReservations.filter((response) => response.status === 409).length === 1, 'concurrent reservation double-booked destination bed');
for (const id of raceMovements) {
  const cancel = await request(`/patient-movements/${id}/cancel`, admin.token, { method: 'POST' });
  assert(cancel.ok, `bed race movement cleanup returned ${cancel.status}`);
}

const disallowedCors = await fetch(`${baseUrl}/openapi.json`, { headers: { origin: 'https://attacker.example' } });
assert(!disallowedCors.headers.get('access-control-allow-origin'), 'untrusted CORS origin was allowed');
const allowedCors = await fetch(`${baseUrl}/openapi.json`, { headers: { origin: 'http://localhost:3000' } });
assert(allowedCors.headers.get('access-control-allow-origin') === 'http://localhost:3000', 'configured CORS origin was rejected');

console.log('Security integration checks passed');
