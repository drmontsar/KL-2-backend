// Run against an isolated database after `bun run seed`.
import assert from 'node:assert/strict';
import { app } from '../src/app';
import { db } from '../src/db';

assert.equal(process.env.DISPOSABLE_DATABASE, '1');
const request = (path: string, body: unknown, token?: string, method = 'POST') => app.request(path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const login = (email: string, password: string, shift?: string) => request('/auth/login', { email, password, shift });
const session = (token?: string) => app.request('/auth/session', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

try {
  assert.equal((await login('bruce+wayne@klinik.com', 'wrong')).status, 401);
  const admin = await login('kiran+patel@klinik.com', 'password');
  assert.equal(admin.status, 200);
  const adminPayload = await admin.json() as { token: string; user: Record<string, unknown> };
  assert(!('password_hash' in adminPayload.user));
  assert.equal((await login('BRUCE+WAYNE@KLINIK.COM', 'password', 'night')).status, 200);
  assert.equal((await login('kiran+patel@klinik.com', 'password', 'night')).status, 401);

  const created = await request('/users', {
    name: 'Nila Test', role: 'doctor', job_role: 'duty_doctor',
    email: 'nila+test@klinik.com', password: 'long-test-password',
  }, adminPayload.token);
  assert.equal(created.status, 201, await created.clone().text());
  const user = await created.json() as { id: string; email: string; phone: string | null; password_hash?: string };
  assert.equal(user.email, 'nila+test@klinik.com');
  assert.equal(user.phone, null);
  assert(!('password_hash' in user));
  const dutyLogin = await login(user.email, 'long-test-password');
  assert.equal(dutyLogin.status, 200);
  const dutyToken = (await dutyLogin.json() as { token: string }).token;
  assert.equal((await session()).status, 401, 'Session identity requires authentication');
  assert.equal((await request('/auth/session', { shift: 'morning' }, undefined, 'PATCH')).status, 401);
  const dutySession = await session(dutyToken);
  const dutyIdentity = await dutySession.json() as { user: { id: string; job_role: string }; shift: string | null };
  assert.equal(dutyIdentity.user.id, user.id);
  assert.equal(dutyIdentity.user.job_role, 'duty_doctor');
  assert.equal(dutyIdentity.shift, null);
  assert.equal((await request('/auth/session', { shift: 'afternoon' }, dutyToken, 'PATCH')).status, 200);
  assert.equal((await (await session(dutyToken)).json() as { shift: string }).shift, 'afternoon');
  assert.equal((await request('/auth/session', { shift: 'invalid' }, dutyToken, 'PATCH')).status, 400);
  assert.equal((await request('/auth/session', { shift: 'night' }, adminPayload.token, 'PATCH')).status, 403,
    'Administrators must not impersonate shift-based clinicians');
  const consultantCreated = await request('/users', { name: 'Test Consultant', role: 'doctor', job_role: 'consultant', email: 'consultant+session@klinik.com', password: 'test-consultant-password' }, adminPayload.token);
  assert.equal(consultantCreated.status, 201);
  const consultantLogin = await login('consultant+session@klinik.com', 'test-consultant-password');
  assert.equal(consultantLogin.status, 200);
  const consultantToken = (await consultantLogin.json() as { token: string }).token;
  assert.equal((await (await session(consultantToken)).json() as { user: { job_role: string } }).user.job_role, 'consultant');
  assert.equal((await request('/auth/session', { shift: 'night' }, consultantToken, 'PATCH')).status, 403);
  const [legacy] = await db<{ id: string }[]>`
    INSERT INTO staff.users (name, role, job_role) VALUES ('Test Legacy', 'nurse', 'staff_nurse') RETURNING id
  `;
  assert.equal((await login('test+legacy@klinik.com', 'long-test-password')).status, 401);
  const provision = await request(`/users/${legacy.id}/credentials`, {
    email: 'test+legacy@klinik.com', password: 'long-test-password',
  }, adminPayload.token, 'PUT');
  assert.equal(provision.status, 200, await provision.clone().text());
  const nurse = await login('test+legacy@klinik.com', 'long-test-password');
  assert.equal(nurse.status, 200);
  const nurseToken = (await nurse.json() as { token: string }).token;
  const nurseSelection = await request('/auth/session', { shift: 'night', role: 'admin' }, nurseToken, 'PATCH');
  assert.equal(nurseSelection.status, 200);
  const nurseIdentity = await nurseSelection.json() as { user: { id: string; role: string }; shift: string };
  assert.equal(nurseIdentity.user.id, legacy.id);
  assert.equal(nurseIdentity.user.role, 'nurse', 'Roles must come from the authenticated session, not request JSON');
  assert.equal(nurseIdentity.shift, 'night');
  assert.equal((await (await session(nurseToken)).json() as { shift: string }).shift, 'night');
  assert.equal((await request(`/users/${user.id}/credentials`, {
    email: 'nila+test@klinik.com', password: 'longer-password',
  }, nurseToken, 'PUT')).status, 403);
  const reset = await request(`/users/${user.id}/credentials`, {
    email: 'nila+test@klinik.com', password: 'updated-test-password',
  }, adminPayload.token, 'PUT');
  assert.equal(reset.status, 200);
  assert.equal((await session(dutyToken)).status, 401, 'Credential resets revoke session introspection as well');
  assert.equal((await login('nila+test@klinik.com', 'long-test-password')).status, 401);
  assert.equal((await login('nila+test@klinik.com', 'updated-test-password')).status, 200);
  const change = await request('/users/me/password', {
    current_password: 'long-test-password', new_password: 'another-test-password',
  }, nurseToken);
  assert.equal(change.status, 204);
  assert.equal((await app.request('/users', { headers: { Authorization: `Bearer ${nurseToken}` } })).status, 401);
  assert.equal((await login('test+legacy@klinik.com', 'another-test-password')).status, 200);
  for (let i = 0; i < 10; i++)
    assert.equal((await login('bruce+wayne@klinik.com', 'wrong')).status, 401);
  assert.equal((await login('bruce+wayne@klinik.com', 'wrong')).status, 429);
  assert.equal((await login('bruce+wayne@klinik.com', 'password')).status, 200,
    'failed attempts must not let attackers lock clinicians out');
  console.log('Email/password authentication and credential lifecycle passed');
} finally {
  await db.end();
}
