import assert from 'node:assert/strict';
import { app } from '../../src/app';
import { db } from '../../src/db';

assert.equal(process.env.DISPOSABLE_DATABASE, '1');
assert.equal(process.env.NODE_ENV, 'production');
try {
  const [before] = await db`SELECT count(*)::int AS n FROM staff.sessions`;
  for (const [path, body] of [
    ['/auth/request', { phone: '1112223330', name: 'Unauthorized signup', role: 'doctor' }],
    ['/auth/verify', { phone: '1112223330', otp: 'arbitrary-otp' }],
  ] as const) {
    const response = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 503);
  }
  const [after] = await db`SELECT count(*)::int AS n FROM staff.sessions`;
  assert.equal(after.n, before.n);
  console.log('Production dummy-auth rejection passed');
} finally {
  await db.end();
}
