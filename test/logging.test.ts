import { expect, test } from 'bun:test';
import { errorDiagnostics } from '../src/logger';

test('error diagnostics retain code and frames without leaking messages or database details', () => {
  const error = Object.assign(new Error('Private patient and phone number'), {
    code: '23505',
    detail: 'Private record data',
    query: 'Private SQL values',
  });
  const diagnostic = errorDiagnostics(error);
  expect(diagnostic.errorCode).toBe('23505');
  expect(diagnostic.stack).toContain('at ');
  expect(JSON.stringify(diagnostic)).not.toContain('Private');
  expect(
    errorDiagnostics(Object.assign(new Error('Other failure'), { code: 'Private data' })).errorCode,
  ).toBeUndefined();
});
