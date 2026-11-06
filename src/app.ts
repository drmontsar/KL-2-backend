import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { config } from './config';
import type { User } from './db/queries/users';
import { authMiddleware } from './middleware/auth';
import { handleError, requestLogging } from './middleware/request_logging';
import { admissionIntakeRouter } from './routes/admission_intake';
import { initialAssessmentsRouter } from './routes/initial_assessments';
import { admissionsRouter } from './routes/admissions';
import { analyticsRouter } from './routes/analytics';
import { authRouter } from './routes/auth';
import { claimsRouter } from './routes/claims';
import { consultantCareTransfersRouter } from './routes/consultant_care_transfers';
import { consultantRoundsRouter } from './routes/consultant_rounds';
import { contingenciesRouter } from './routes/contingencies';
import { crossReferralsRouter } from './routes/cross_referrals';
import { admissionHeaderRouter, dashboardRouter } from './routes/dashboard';
import { diagnosesRouter } from './routes/diagnoses';
import { dischargePlansRouter } from './routes/discharge_plans';
import { eventsRouter } from './routes/events';
import { formsRouter } from './routes/forms';
import { handoffsRouter } from './routes/handoffs';
import { handoverSessionsRouter } from './routes/handover_sessions';
import { healthRouter } from './routes/health';
import { ipassRouter } from './routes/ipass';
import { medicationAdministrationRouter } from './routes/medication_administration';
import { notesRouter } from './routes/notes';
import { notificationsRouter } from './routes/notifications';
import { nurseHandoverRouter } from './routes/nurse_handover';
import { nursingRouter } from './routes/nursing';
import { nursingCarePlanRouter } from './routes/nursing_care_plan';
import { opdRouter } from './routes/opd';
import { orderSetsRouter } from './routes/order_sets';
import { ordersRouter, tasksRouter } from './routes/orders';
import { organizationRouter } from './routes/organization';
import { patientIdentityRouter } from './routes/patient_identity';
import { patientMovementsRouter } from './routes/patient_movements';
import { patientsRouter } from './routes/patients';
import { shiftEventsRouter } from './routes/shift_events';
import { staffScopeRouter } from './routes/staff_scope';
import { transferRequestsRouter } from './routes/transfer_requests';
import { usersRouter } from './routes/users';
import { worklistsRouter } from './routes/worklists';

type Variables = { user: User; requestId: string };

export function makeApp() {
  const app = new OpenAPIHono<{ Variables: Variables }>();

  app.use('*', requestLogging);
  app.onError(handleError);

  app.use('*', cors({ origin: config.corsOrigins }));

  // Public routes — no token required
  app.route('/auth', authRouter);
  app.route('/', healthRouter);

  // All routes below require a valid session
  const UNPROTECTED = ['/auth', '/docs', '/openapi.json'];
  app.use('*', async (c, next) => {
    if (
      c.req.path === '/health' ||
      c.req.path === '/ready' ||
      UNPROTECTED.some((p) => c.req.path.startsWith(p))
    )
      return next();
    return authMiddleware(c, next);
  });

  app.route('/', organizationRouter);
  app.route('/', staffScopeRouter);
  app.route('/', patientIdentityRouter);
  app.route('/', admissionIntakeRouter);
  app.route('/', initialAssessmentsRouter);
  app.route('/', nursingRouter);
  app.route('/', nursingCarePlanRouter);
  app.route('/', medicationAdministrationRouter);
  app.route('/users', usersRouter);
  app.route('/patients', patientsRouter);
  app.route('/opd', opdRouter);
  app.route('/forms', formsRouter);
  app.route('/ipass', ipassRouter);
  app.route('/nurse-handover', nurseHandoverRouter);
  app.route('/claims', claimsRouter);
  app.route('/discharge-plans', dischargePlansRouter);
  app.route('/patient-movements', patientMovementsRouter);
  app.route('/admissions', admissionsRouter);
  app.route('/admissions', admissionHeaderRouter);
  app.route('/dashboard', dashboardRouter);
  app.route('/notes', notesRouter);
  app.route('/orders', ordersRouter);
  app.route('/tasks', tasksRouter);
  app.route('/diagnoses', diagnosesRouter);
  app.route('/handoffs', handoffsRouter);
  app.route('/admissions', contingenciesRouter);
  app.route('/admissions', shiftEventsRouter);
  app.route('/notifications', notificationsRouter);
  app.route('/handover-sessions', handoverSessionsRouter);
  app.route('/analytics', analyticsRouter);
  app.route('/transfer-requests', transferRequestsRouter);
  app.route('/events', eventsRouter);
  app.route('/worklists', worklistsRouter);
  app.route('/order-sets', orderSetsRouter);
  app.route('/cross-referrals', crossReferralsRouter);
  app.route('/consultant-rounds', consultantRoundsRouter);
  app.route('/consultant-care-transfers', consultantCareTransfersRouter);

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'KliniK API',
      version: '0.2.0',
      description: 'Doctor rounds companion — KliniK Phase 1',
    },
  });

  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  return app;
}

export const app = makeApp();
export type AppType = ReturnType<typeof makeApp>;
