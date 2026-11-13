import { expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { User } from '../src/db/queries/users';
import { patientMovementsRouter } from '../src/routes/patient_movements';

const id = 'a0000000-0000-4000-8000-000000000001';
for (const job_role of ['duty_doctor', 'consultant'] as const) {
  test(`${job_role} cannot create a temporary visit, before accessing or mutating patient records`, async () => {
    const user: User = { id, name: 'Doctor', role: 'doctor', job_role, registration_number: null, specialization: null, phone: null, current_area: null, last_seen_at: null, created_at: new Date(), disabled_at: null };
    const app = new OpenAPIHono<{ Variables: { user: User } }>();
    app.use('*', async (c, next) => { c.set('user', user); await next(); });
    app.route('/patient-movements', patientMovementsRouter);
    const response = await app.request('/patient-movements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admission_id: id, movement_type: 'temporary', destination_area: 'CT', reason: 'Imaging', escort: 'nurse', equipment: [] }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'not found or forbidden' });
  });
}
