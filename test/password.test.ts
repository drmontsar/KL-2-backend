import { expect, test } from 'bun:test';
import { hashPassword, verifyPassword } from '../src/security/password';

test('passwords use salted, verifiable scrypt hashes', async () => {
  const first = await hashPassword('password');
  const second = await hashPassword('password');
  expect(first).not.toBe(second);
  expect(first).not.toContain('password');
  expect(await verifyPassword('password', first)).toBe(true);
  expect(await verifyPassword('incorrect', first)).toBe(false);
  expect(await verifyPassword('password', 'not-a-password-hash')).toBe(false);
});
