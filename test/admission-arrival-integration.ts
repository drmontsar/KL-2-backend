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
  assert((await post(adminToken)).status === 403, 'Non-nurse must not check in patient');
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
  const [after] = await db<{ status: string; arrival_status: string; arrived_at: Date; schedule_count: number }[]>`
    SELECT c.status, a.arrival_status, a.arrived_at,
      (SELECT count(*)::int FROM clinical.observation_schedules WHERE admission_id = a.id) AS schedule_count
    FROM clinical.admissions a JOIN clinical.admission_checklist_items c ON c.admission_id = a.id AND c.code = 'unit_arrival'
    WHERE a.id = ${admission!.id}
  `;
  assert(after.status === 'completed' && after.arrival_status === 'admitted' && after.arrived_at && after.schedule_count === 1,
    'Check-in must complete checklist and start clinical observations');
  console.log('Admission arrival workflow integration passed');
} finally {
  await db.end();
}
