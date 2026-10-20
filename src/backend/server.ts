import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { routePath } from 'hono/route';
import { config } from './config';
import { logger } from './logger';
import { authMiddleware } from './middleware/auth';
import { admissionsRouter } from './routes/admissions';
import { authRouter } from './routes/auth';
import { contingenciesRouter } from './routes/contingencies';
import { diagnosesRouter } from './routes/diagnoses';
import { eventsRouter } from './routes/events';
import { handoffsRouter } from './routes/handoffs';
import { notesRouter } from './routes/notes';
import { notificationsRouter } from './routes/notifications';
import { ordersRouter, tasksRouter } from './routes/orders';
import { patientsRouter } from './routes/patients';
import { shiftEventsRouter } from './routes/shift_events';
import { usersRouter } from './routes/users';
import type { User } from './db/queries/users';

type Variables = { user: User };

const app = new OpenAPIHono<{ Variables: Variables }>();

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

// Public routes — no token required
app.route('/auth', authRouter);

// All routes below require a valid session
const UNPROTECTED = ['/auth', '/docs', '/openapi.json'];
app.use('*', async (c, next) => {
  if (UNPROTECTED.some((p) => c.req.path.startsWith(p))) return next();
  return authMiddleware(c, next);
});

app.route('/users', usersRouter);
app.route('/patients', patientsRouter);
app.route('/admissions', admissionsRouter);
app.route('/notes', notesRouter);
app.route('/orders', ordersRouter);
app.route('/tasks', tasksRouter);
app.route('/diagnoses', diagnosesRouter);
app.route('/handoffs', handoffsRouter);
app.route('/admissions', contingenciesRouter);
app.route('/admissions', shiftEventsRouter);
app.route('/notifications', notificationsRouter);
app.route('/events', eventsRouter);

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
