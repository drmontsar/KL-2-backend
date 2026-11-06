// Run only against an isolated, seeded test database (not a shared development database).
import { app } from '../src/app';
import { db } from '../src/db';
import { acceptAdmissionRequest } from '../src/db/queries/admission_intake';
import { createSession } from '../src/db/queries/auth';

if (process.env.NODE_ENV !== 'test') throw new Error('Requires NODE_ENV=test and an isolated seeded database');
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

try {
  const [admin] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'administrator' LIMIT 1`;
  const [nurse] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'staff_nurse' AND disabled_at IS NULL LIMIT 1`;
  const [otherNurse] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'staff_nurse' AND disabled_at IS NULL AND id <> ${nurse.id} LIMIT 1`;
  const [consultant] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'consultant' AND disabled_at IS NULL LIMIT 1`;
  const [bed] = await db<{ id: string; unit_id: string }[]>`
    SELECT b.id, w.unit_id FROM organization.beds b
    JOIN organization.rooms r ON r.id = b.room_id JOIN organization.wards w ON w.id = r.ward_id
    WHERE b.operational_state = 'available'
      AND NOT EXISTS (SELECT 1 FROM clinical.admissions a WHERE a.bed_id = b.id AND a.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM organization.bed_reservations r WHERE r.bed_id = b.id AND r.released_at IS NULL) LIMIT 1
  `;
  assert(admin && nurse && otherNurse && consultant && bed, 'Seed must contain an admin, two nurses, consultant and free bed');
  const [patient] = await db<{ id: string }[]>`
    INSERT INTO clinical.patients (name, dob, created_by) VALUES ('Arrival workflow integration', '1990-01-01', ${admin.id}) RETURNING id
  `;
  const [request] = await db<{ id: string }[]>`
    INSERT INTO clinical.admission_requests (patient_id, source, diagnosis, requested_unit_id, requested_by)
    VALUES (${patient.id}, 'elective', 'Arrival workflow test', ${bed.unit_id}, ${admin.id}) RETURNING id
  `;
  const accepted = await acceptAdmissionRequest({
    bed_id: bed.id, consultant_id: consultant.id, nurse_id: nurse.id,
  }, request.id, admin.id);
  const admission = accepted?.admission;
  assert(admission?.arrival_status === 'incoming' && admission.assigned_to === nurse.id, 'Acceptance must create assigned incoming admission');
  const [before] = await db<{ status: string; schedule_count: number }[]>`
    SELECT c.status, (SELECT count(*)::int FROM clinical.observation_schedules WHERE admission_id = ${admission!.id}) AS schedule_count
    FROM clinical.admission_checklist_items c WHERE c.admission_id = ${admission!.id} AND c.code = 'unit_arrival'
  `;
  assert(before.status === 'pending' && before.schedule_count === 0, 'Arrival remains pending until bedside confirmation');

  const nurseToken = await createSession(nurse.id);
  const adminToken = await createSession(admin.id);
  const [doctor] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'duty_doctor' AND disabled_at IS NULL LIMIT 1`;
  assert(doctor, 'Seed must contain a duty doctor');
  const doctorToken = await createSession(doctor.id);
  const assessmentPath = `/admissions/${admission!.id}/initial-assessment`;
  const assessmentBody = {
    chief_complaint: 'Shortness of breath', history: 'Two days of worsening dyspnea',
    examination: 'Tachypneic, bilateral crackles', clinical_impression: 'Possible pneumonia',
    plan: 'Obtain chest radiograph and monitor oxygen saturation',
  };
  const submitAssessment = (token: string) => app.request(assessmentPath, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(assessmentBody),
  });
  const required = async () => {
    const response = await app.request('/admissions/initial-assessment-required', { headers: { Authorization: `Bearer ${doctorToken}` } });
    assert(response.status === 200, 'Duty-doctor assessment queue must load');
    return (await response.json() as { id: string }[]).some((row) => row.id === admission!.id);
  };
  assert(!(await required()), 'Incoming patient must not enter the doctor assessment queue yet');
  assert((await submitAssessment(doctorToken)).status === 409, 'Initial assessment must wait for nurse check-in');
  assert((await app.request('/admissions', {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_id: patient.id, bed_id: bed.id }),
  })).status === 409, 'Direct admission must not bypass nurse/consultant intake');
  const bedOccupancy = async () => {
    const response = await app.request('/beds', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(response.status === 200, 'Bed list must load');
    return (await response.json() as { id: string; occupancy: string }[]).find((row) => row.id === bed.id)?.occupancy;
  };
  assert((await bedOccupancy()) === 'reserved', 'Incoming bed should be reserved, not occupied');
  const otherNurseToken = await createSession(otherNurse.id);
  const endpoint = `/admissions/${admission!.id}/confirm-in-bed`;
  const post = (token: string, path = endpoint) => app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert((await post(adminToken)).status === 403, 'Administrator must not check in patient');
  assert((await post(otherNurseToken)).status === 409, 'Another nurse must not check in patient');
  const [arrival] = await db<{ id: string }[]>`SELECT id FROM clinical.admission_checklist_items WHERE admission_id = ${admission!.id} AND code = 'unit_arrival'`;
  assert((await app.request(`/admission-checklist/${arrival.id}/complete`, {
    method: 'POST', headers: { Authorization: `Bearer ${nurseToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidence: 'bypass' }),
  })).status !== 200, 'Generic checklist endpoint must not bypass bedside check-in');
  const checkedIn = await post(nurseToken);
  assert(checkedIn.status === 200 && (await checkedIn.json()).arrival_status === 'admitted', 'Assigned nurse must be able to check in');
  assert((await post(nurseToken)).status === 409, 'Check-in must be idempotent');
  assert((await bedOccupancy()) === 'occupied', 'Checked-in bed should be occupied');
  assert(await required(), 'Newly admitted patient should require initial assessment');
  const [doctorChecklist] = await db<{ id: string }[]>`SELECT id FROM clinical.admission_checklist_items WHERE admission_id = ${admission!.id} AND code = 'doctor_assessment'`;
  assert((await app.request(`/admission-checklist/${doctorChecklist.id}/complete`, {
    method: 'POST', headers: { Authorization: `Bearer ${doctorToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidence: 'without assessment' }),
  })).status === 409, 'Doctor assessment cannot be checked off without recording it');
  assert((await submitAssessment(nurseToken)).status === 403, 'Nurse must not sign doctor assessment');
  const incomplete = await app.request(assessmentPath, {
    method: 'POST', headers: { Authorization: `Bearer ${doctorToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...assessmentBody, examination: ' ' }),
  });
  assert(incomplete.status === 400, 'Empty examination must not complete assessment');
  const signed = await submitAssessment(doctorToken);
  assert(signed.status === 201 && (await signed.json()).clinical_impression === assessmentBody.clinical_impression,
    'Duty doctor must be able to sign structured assessment');
  assert((await submitAssessment(doctorToken)).status === 409, 'Assessment should only be signed once');
  assert(!(await required()), 'Signed assessment must leave the queue');
  const [completedAssessment] = await db<{ status: string; completed_by: string }[]>`
    SELECT status, completed_by FROM clinical.admission_checklist_items WHERE id = ${doctorChecklist.id}
  `;
  assert(completedAssessment.status === 'completed' && completedAssessment.completed_by === doctor.id,
    'Signing must complete the doctor checklist atomically');
  const stored = await app.request(assessmentPath, { headers: { Authorization: `Bearer ${nurseToken}` } });
  assert(stored.status === 200 && (await stored.json()).chief_complaint === assessmentBody.chief_complaint,
    'Assigned nurse should be able to read signed assessment');
  const [after] = await db<{ status: string; arrival_status: string; arrived_at: Date; schedule_count: number }[]>`
    SELECT c.status, a.arrival_status, a.arrived_at,
      (SELECT count(*)::int FROM clinical.observation_schedules WHERE admission_id = a.id) AS schedule_count
    FROM clinical.admissions a JOIN clinical.admission_checklist_items c ON c.admission_id = a.id AND c.code = 'unit_arrival'
    WHERE a.id = ${admission!.id}
  `;
  assert(after.status === 'completed' && after.arrival_status === 'admitted' && after.arrived_at && after.schedule_count === 1,
    'Check-in must complete checklist and start clinical observations');

  // A duty doctor can manually confirm a different incoming patient, without
  // taking the assigned nurse's ownership or bypassing the same atomic steps.
  const [secondBed] = await db<{ id: string; unit_id: string }[]>`
    SELECT b.id, w.unit_id FROM organization.beds b
    JOIN organization.rooms r ON r.id = b.room_id JOIN organization.wards w ON w.id = r.ward_id
    WHERE b.operational_state = 'available' AND b.id <> ${bed.id}
      AND NOT EXISTS (SELECT 1 FROM clinical.admissions a WHERE a.bed_id = b.id AND a.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM organization.bed_reservations r WHERE r.bed_id = b.id AND r.released_at IS NULL) LIMIT 1
  `;
  assert(secondBed, 'Seed must contain a second free bed for doctor check-in');
  const [secondPatient] = await db<{ id: string }[]>`
    INSERT INTO clinical.patients (name, dob, created_by) VALUES ('Doctor arrival confirmation', '1992-01-01', ${admin.id}) RETURNING id
  `;
  const [secondRequest] = await db<{ id: string }[]>`
    INSERT INTO clinical.admission_requests (patient_id, source, diagnosis, requested_unit_id, requested_by)
    VALUES (${secondPatient.id}, 'elective', 'Arrival check', ${secondBed.unit_id}, ${admin.id}) RETURNING id
  `;
  const second = await acceptAdmissionRequest({ bed_id: secondBed.id, consultant_id: consultant.id, nurse_id: nurse.id }, secondRequest.id, admin.id);
  assert(second?.admission.arrival_status === 'incoming', 'Second admission must be incoming');
  const doctorEndpoint = `/admissions/${second!.admission.id}/confirm-in-bed`;
  const doctorCheckIn = await post(doctorToken, doctorEndpoint);
  assert(doctorCheckIn.status === 200 && (await doctorCheckIn.json()).arrival_status === 'admitted', 'Duty doctor must be able to manually admit incoming patient');
  assert((await post(doctorToken, doctorEndpoint)).status === 409, 'Repeated doctor check-in must be rejected');
  assert((await post(otherNurseToken, doctorEndpoint)).status === 409, 'Wrong nurse must not override doctor check-in');
  const [doctorArrival] = await db<{ completed_by: string; evidence: string; schedule_count: number; assigned_to: string }[]>`
    SELECT c.completed_by, c.evidence, a.assigned_to,
      (SELECT count(*)::int FROM clinical.observation_schedules WHERE admission_id = a.id) AS schedule_count
    FROM clinical.admissions a JOIN clinical.admission_checklist_items c ON c.admission_id = a.id AND c.code = 'unit_arrival'
    WHERE a.id = ${second!.admission.id}
  `;
  assert(doctorArrival.completed_by === doctor.id && doctorArrival.evidence.includes('duty doctor')
    && doctorArrival.assigned_to === nurse.id && doctorArrival.schedule_count === 1,
    'Manual check-in must audit doctor without reassigning nurse or skipping observation scheduling');

  // Old request-created admissions could already say "admitted" even though
  // their arrival and doctor checklist steps were still pending. Recovery must
  // require explicit confirmation and must not create a second schedule.
  await db`UPDATE clinical.admissions SET assigned_to = NULL, arrived_at = admitted_at
    WHERE id = ${second!.admission.id}`;
  await db`UPDATE clinical.admission_checklist_items SET status = 'pending', completed_by = NULL,
    completed_at = NULL, evidence = NULL WHERE admission_id = ${second!.admission.id} AND code = 'unit_arrival'`;
  const legacyConfirm = await post(doctorToken, doctorEndpoint);
  assert(legacyConfirm.status === 200, 'Duty doctor must be able to confirm a legacy unconfirmed arrival');
  const [legacyResult] = await db<{ schedule_count: number; arrival_status: string; arrival_step: string; completed_by: string }[]>`
    SELECT a.arrival_status, c.status AS arrival_step, c.completed_by,
      (SELECT count(*)::int FROM clinical.observation_schedules WHERE admission_id = a.id) AS schedule_count
    FROM clinical.admissions a JOIN clinical.admission_checklist_items c ON c.admission_id = a.id AND c.code = 'unit_arrival'
    WHERE a.id = ${second!.admission.id}
  `;
  assert(legacyResult.arrival_status === 'admitted' && legacyResult.arrival_step === 'completed'
    && legacyResult.completed_by === doctor.id && legacyResult.schedule_count === 1,
    'Recovery must complete arrival and retain the existing observation schedule');
  assert((await post(doctorToken, doctorEndpoint)).status === 409, 'Recovered arrival cannot be confirmed twice');
  console.log('Admission arrival workflow integration passed');
} finally {
  await db.end();
}
