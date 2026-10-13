import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { routePath } from 'hono/route';
import { config } from './config';
import { logger } from './logger';
import { admissionsRouter } from './routes/admissions';
import { diagnosesRouter } from './routes/diagnoses';
import { handoffsRouter } from './routes/handoffs';
import { notesRouter } from './routes/notes';
import { ordersRouter, tasksRouter } from './routes/orders';
import { patientsRouter } from './routes/patients';
import { usersRouter } from './routes/users';

const app = new OpenAPIHono();

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logger.info(
    {
      method: c.req.method,
      route: routePath(c, -1),
      status: c.res.status,
      durationMs: Date.now() - start,
    },
    'request completed'
  );
});

app.onError((error, c) => {
  logger.error(
    {
      method: c.req.method,
      route: routePath(c, -1),
      errorType: error instanceof Error ? error.name : 'unknown',
    },
    'request failed'
  );
  return c.text('Internal Server Error', 500);
});

app.use('*', cors());

app.route('/users', usersRouter);
app.route('/patients', patientsRouter);
app.route('/admissions', admissionsRouter);
app.route('/notes', notesRouter);
app.route('/orders', ordersRouter);
app.route('/tasks', tasksRouter);
app.route('/diagnoses', diagnosesRouter);
app.route('/handoffs', handoffsRouter);

app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'KliniK API',
    version: '0.2.0',
    description: 'Doctor rounds companion — KliniK Phase 1',
  },
});

app.get('/docs', swaggerUI({ url: '/openapi.json' }));

export type AppType = typeof app;

export default { port: config.port, fetch: app.fetch };
