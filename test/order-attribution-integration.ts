// Run against a disposable seeded database only. Creates synthetic patients and orders.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app';
import { db } from '../src/db';
import { createSession } from '../src/db/queries/auth';

if (process.env.NODE_ENV !== 'test' || process.env.DISPOSABLE_DATABASE !== '1') throw new Error('Requires an isolated disposable test database');

try {
  const [doctor] = await db<{ id: string; name: string }[]>`SELECT id, name FROM staff.users WHERE job_role = 'duty_doctor' AND disabled_at IS NULL LIMIT 1`;
  const [consultant] = await db<{ id: string; name: string }[]>`SELECT id, name FROM staff.users WHERE job_role = 'consultant' AND disabled_at IS NULL LIMIT 1`;
  const [nurse] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE role = 'nurse' AND disabled_at IS NULL LIMIT 1`;
  assert(doctor && consultant && nurse, 'Requires seeded clinical staff');
  const [patient] = await db<{ id: string }[]>`INSERT INTO clinical.patients (name, dob, created_by) VALUES ('Order attribution test patient', '1990-01-01', ${doctor.id}) RETURNING id`;
  const [admission] = await db<{ id: string }[]>`INSERT INTO clinical.admissions (patient_id, ward, bed, created_by, arrival_status, arrived_at) VALUES (${patient.id}, 'Attribution test', ${randomUUID()}, ${doctor.id}, 'admitted', now()) RETURNING id`;
  const token = await createSession(doctor.id);
  const nurseToken = await createSession(nurse.id);
  const path = `/admissions/${admission.id}/orders`;
  const call = (url: string, bearer: string | null, method = 'GET', body?: unknown) => app.request(url, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const body = { kind: 'investigation', payload: { name: 'Synthetic lab test', imaging: false }, advised_by: consultant.id, created_by: consultant.id };
  assert.equal((await call(path, null, 'POST', body)).status, 401);
  assert.equal((await call(path, nurseToken, 'POST', body)).status, 403);
  const created = await call(path, token, 'POST', body);
  assert.equal(created.status, 201, await created.clone().text());
  const order = await created.json() as { id: string; advised_by: string; created_by: string };
  assert.equal(order.created_by, doctor.id, 'The authenticated clinician, not client-created_by, placed the order');
  assert.equal(order.advised_by, consultant.id);
  assert.equal((await call(`/orders/${order.id}/confirm`, token, 'POST', {})).status, 200);
  const list = await call(path, token);
  assert.equal(list.status, 200);
  const listed = await list.json() as { id: string; advised_by_name: string | null; ordered_by_name: string | null; advised_by: string | null }[];
  const saved = listed.find((entry) => entry.id === order.id);
  assert.equal(saved?.advised_by_name, consultant.name);
  assert.equal(saved?.ordered_by_name, doctor.name);
  assert.equal((await call(path, token, 'POST', { ...body, advised_by: nurse.id })).status, 409);
  assert.equal((await call(path, token, 'POST', { ...body, advised_by: randomUUID() })).status, 409);
  const legacy = await call(path, token, 'POST', { kind: 'investigation', payload: { name: 'Legacy client order' } });
  assert.equal(legacy.status, 201);
  assert.equal((await legacy.json() as { advised_by: string | null }).advised_by, null, 'Missing advice must not be inferred');
  await db`UPDATE staff.users SET disabled_at = now() WHERE id = ${consultant.id}`;
  assert.equal((await call(path, token, 'POST', body)).status, 409, 'Disabled staff cannot be newly attributed');
  const historical = await (await call(path, token)).json() as { id: string; advised_by_name: string | null }[];
  assert.equal(historical.find((entry) => entry.id === order.id)?.advised_by_name, consultant.name, 'Historical attribution survives staff deactivation');
  console.log('Order attribution, authenticated actor and legacy compatibility integration passed');
} finally { await db.end(); }
