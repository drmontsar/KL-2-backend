import { actor, admission, assert, db, request } from './support';

export async function checkAccess() {
  const doctor = await actor();
  const nurse = await actor('nurse');
  const pharmacist = await actor('admin', 'pharmacist');
  const admin = await actor('admin');
  const a = await admission(doctor, nurse);
  await db`UPDATE clinical.admissions SET assigned_doctor_id = NULL WHERE id = ${a.id}`;
  const [unit] = await db<{ id: string }[]>`SELECT id FROM organization.units LIMIT 1`;
  await db`UPDATE clinical.admissions SET unit_id = ${unit.id} WHERE id = ${a.id}`;
  assert.equal((await request(doctor, `/admissions/${a.id}`)).status, 403);
  assert.equal((await request(doctor, `/admissions/${a.id}/claim`, 'POST')).status, 404);
  await db`INSERT INTO staff.unit_memberships (user_id, unit_id) VALUES (${doctor.user.id}, ${unit.id})`;
  assert.equal(
    (await request(doctor, `/admissions/${a.id}/claim`, 'POST')).status,
    404,
    'membership alone must not authorize claiming',
  );
  const [shift] = await db<
    { id: string }[]
  >`INSERT INTO staff.shifts (user_id, starts_at, ends_at, status, created_by)
    VALUES (${doctor.user.id}, now() - interval '1 hour', now() + interval '1 hour', 'active', ${admin.user.id}) RETURNING id`;
  await db`INSERT INTO staff.shift_units (shift_id, unit_id) VALUES (${shift.id}, ${unit.id})`;
  assert.equal((await request(doctor, `/admissions/${a.id}/claim`, 'POST')).status, 200);
  const [assignment] =
    await db`SELECT count(*)::int AS n FROM clinical.staff_assignments WHERE admission_id = ${a.id} AND user_id = ${doctor.user.id} AND ends_at IS NULL`;
  assert.equal(assignment.n, 1);
  const h = await request(doctor, `/admissions/${a.id}/handoffs`, 'POST', {
    reason: 'Private handoff',
  });
  assert.equal(h.status, 201);
  assert.equal((await request(pharmacist, `/handoffs?nurse_id=${nurse.user.id}`)).status, 403);
  assert.equal((await request(nurse, '/handoffs')).status, 200);
  assert.equal((await request(admin, `/handoffs?nurse_id=${nurse.user.id}`)).status, 200);
  assert.equal(
    (await request(admin, '/users', 'POST', { name: 'Missing phone', role: 'nurse' })).status,
    400,
  );
  assert.equal(
    (
      await request(admin, '/users', 'POST', {
        name: 'Duplicate',
        role: 'doctor',
        phone: doctor.user.phone,
      })
    ).status,
    409,
  );
}
