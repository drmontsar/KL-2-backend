import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const params = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, 64, params, (error, hash) =>
    error ? reject(error) : resolve(hash));
});

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(stored)) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const hash = await derive(password, Buffer.from(saltHex, 'hex'));
  return timingSafeEqual(hash, expected);
}
