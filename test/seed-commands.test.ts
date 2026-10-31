import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { scripts } from '../package.json';
import staff from '../test-data/staff.json';

test('demo setup has a single seed command', () => {
  expect(
    Object.keys(scripts).filter((name) => name === 'seed' || name.startsWith('seed:')),
  ).toEqual(['seed']);
  expect(scripts.seed).toBe('bun run src/db/seed-test-data.ts');
});

test('demo reset reuses the fixture loader with an explicit destructive flag', () => {
  expect(scripts['reset:demo']).toBe('bun run src/db/seed-test-data.ts --reset');
  const users = staff.find((group) => group.table === 'staff.users')!.rows;
  expect(users.find((row) => 'phone' in row && row.phone === '1112223330')).toMatchObject({
    name: 'Bruce Wayne',
    role: 'doctor',
    job_role: 'duty_doctor',
  });
});

test('demo reset rejects production, remote, and unexpected database targets before connecting', () => {
  const fixture = fileURLToPath(new URL('../src/db/seed-test-data.ts', import.meta.url));
  for (const target of [
    { NODE_ENV: 'production', DATABASE_URL: 'postgres://klinik:klinik@127.0.0.1:1/klinik' },
    { NODE_ENV: 'test', DATABASE_URL: 'postgres://klinik:klinik@example.invalid/klinik' },
    { NODE_ENV: 'test', DATABASE_URL: 'postgres://klinik:klinik@127.0.0.1:1/other' },
  ]) {
    const result = Bun.spawnSync([process.execPath, fixture, '--reset'], {
      env: { ...process.env, ...target },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('Refusing to seed');
  }
});

test('destructive legacy setup rejects non-test and non-disposable environments before connecting', () => {
  const fixture = fileURLToPath(new URL('./fixtures/legacy/seed.ts', import.meta.url));
  for (const env of [
    { NODE_ENV: 'test', DISPOSABLE_DATABASE: '' },
    { NODE_ENV: 'production', DISPOSABLE_DATABASE: '1' },
  ]) {
    const result = Bun.spawnSync([process.execPath, fixture], {
      env: { ...process.env, ...env, DATABASE_URL: 'postgres://klinik:klinik@127.0.0.1:1/klinik' },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      'Legacy fixtures require a disposable integration-test database',
    );
  }
});
