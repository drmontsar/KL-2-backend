import assert from 'node:assert/strict';
import { app } from '../../src/app';
import { db } from '../../src/db';

assert.equal(process.env.DISPOSABLE_DATABASE, '1');
assert.equal(process.env.NODE_ENV, 'production');
const post = (path: string, body: unknown) => app.request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
try {
  const [before] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM staff.sessions`;
  assert.equal((await post('/auth/request', { phone: '1112223330' })).status, 404);
  assert.equal((await post('/auth/verify', { phone: '1112223330', otp: '123456' })).status, 404);
  assert.equal((await post('/auth/login', { email: 'bruce+wayne@klinik.com', password: 'wrong' })).status, 401);
  const response = await post('/auth/login', { email: 'BRUCE+WAYNE@KLINIK.COM', password: 'password', shift: 'night' });
  assert.equal(response.status, 200);
  const { token, user } = await response.json() as { token: string; user: Record<string, unknown> };
  assert.equal(user.job_role, 'duty_doctor');
  assert(!('password_hash' in user));
  const [during] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM staff.sessions`;
  assert.equal(during.n, before.n + 1);
  assert.equal((await app.request('/auth/session', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status, 204);
  const [after] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM staff.sessions`;
  assert.equal(after.n, before.n);
  console.log('Production email/password login passed');
} finally {
  await db.end();
}
