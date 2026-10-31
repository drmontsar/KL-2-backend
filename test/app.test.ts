import { describe, expect, test } from 'bun:test';
import { app, makeApp } from '../src/app';

describe('application routing', () => {
  test('application factories do not start a server and retain independent route tables', async () => {
    const first = makeApp();
    const second = makeApp();
    first.get('/factory-test', (c) => c.text('first'));
    expect((await first.request('/factory-test')).status).toBe(401);
    expect(first.routes.some((route) => route.path === '/factory-test')).toBe(true);
    expect(second.routes.some((route) => route.path === '/factory-test')).toBe(false);
  });
  test('health and API documentation are public', async () => {
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/docs')).status).toBe(200);
    const response = await app.request('/openapi.json');
    expect(response.status).toBe(200);
    const spec = (await response.json()) as { paths: Record<string, unknown> };
    expect(spec.paths['/health']).toBeDefined();
    expect(spec.paths['/admissions']).toBeDefined();
  });

  test('clinical routes require authentication', async () => {
    const response = await app.request('/admissions');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });
});
