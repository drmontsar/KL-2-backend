import { expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { User } from '../src/db/queries/users';
import { tasksRouter } from '../src/routes/orders';

const id = 'a0000000-0000-4000-8000-000000000001';
const doctor: User = { id, name: 'Doctor', role: 'doctor', job_role: 'duty_doctor', registration_number: null, specialization: null, phone: null, current_area: null, last_seen_at: null, created_at: new Date(), disabled_at: null };
for (const job_role of ['duty_doctor', 'consultant'] as const) {
  for (const operation of ['complete', 'cancel']) {
    test(`${job_role} cannot ${operation} a nursing task, before any resource mutation`, async () => {
      const app = new OpenAPIHono<{ Variables: { user: User } }>();
      app.use('*', async (c, next) => { c.set('user', { ...doctor, job_role }); await next(); });
      app.route('/tasks', tasksRouter);
      const response = await app.request(`/tasks/${id}/${operation}`, { method: 'POST' });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'nursing access required' });
    });
  }
}
