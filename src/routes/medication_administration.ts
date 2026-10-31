import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import {
  CatalogItemSchema,
  DoseBody,
  DoseSchema,
  GiveBody,
  HoldBody,
  InfusionBody,
  InfusionSchema,
  ReviewBody,
  ReviewSchema,
  ScheduleBody,
  ScheduleSchema,
} from '../contracts/medication_administration';
import {
  createMedicationSchedule,
  getDoseAdmission,
  getMedicationSchedule,
  giveMedicationDose,
  listInfusionEvents,
  listLatestAllergyReviews,
  listMedicationDoses,
  listMedicationSchedules,
  preparePrnDose,
  recordAllergyReview,
  recordDoseException,
  recordInfusionEvent,
  scheduleMedicationDose,
  searchMedicationCatalog,
} from '../db/queries/medication_administration';

import { ErrorSchema, IdParam } from '../contracts/common';
import { canAccessAdmission, canAccessResource } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const medicationAdministrationRouter = new OpenAPIHono<{ Variables: Variables }>();

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/medication-catalog',
    tags: ['Medication Administration'],
    request: { query: z.object({ q: z.string().trim().max(200).default('') }) },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(CatalogItemSchema) } },
        description: 'Synthetic medication catalogue; not for clinical use',
      },
    },
  }),
  async (c) => {
    const { q } = c.req.valid('query');
    const rows = await searchMedicationCatalog(q);
    return c.json(rows, 200);
  },
);

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'post',
    path: '/orders/{id}/medication-schedule',
    tags: ['Medication Administration'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: ScheduleBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: ScheduleSchema } },
        description: 'Schedule created from confirmed medication order',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Order unavailable, fields do not match prescription, or schedule exists',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.doctor') || !(await canAccessResource(user, 'order', id)))
      return c.json({ error: 'not found or forbidden' }, 403);

    const schedule = await createMedicationSchedule(body, user.id, id);
    if (!schedule)
      return c.json({ error: 'order unavailable or fields do not match prescription' }, 409);
    return c.json(schedule, 201);
  },
);

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}/medication-schedules',
    tags: ['Medication Administration'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(ScheduleSchema) } },
        description: 'Medication schedules for admission',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessAdmission(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listMedicationSchedules(id), 200);
  },
);

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'post',
    path: '/medication-schedules/{id}/allergy-review',
    tags: ['Medication Administration'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ReviewBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: ReviewSchema } },
        description: 'Clinician allergy review recorded',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Schedule unavailable',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [schedule] = await getMedicationSchedule(id);
    if (
      !schedule ||
      !hasPermission(user, 'clinical.doctor') ||
      !(await canAccessAdmission(user, schedule.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const review = await recordAllergyReview(id, body, user.id);
    if (!review) return c.json({ error: 'schedule unavailable' }, 409);
    return c.json(review, 201);
  },
);

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'post',
    path: '/medication-schedules/{id}/doses',
    tags: ['Medication Administration'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: DoseBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: DoseSchema } },
        description: 'Dose scheduled',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Schedule unavailable or dose already exists',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [schedule] = await getMedicationSchedule(id);
    if (
      !schedule ||
      !hasPermission(user, 'clinical.doctor') ||
      !(await canAccessAdmission(user, schedule.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);

    const row = await scheduleMedicationDose(body.due_at, id, user.id);
    if (!row) return c.json({ error: 'schedule unavailable' }, 409);
    return c.json(row, 201);
  },
);

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'post',
    path: '/medication-schedules/{id}/prn-doses',
    tags: ['Medication Administration'],
    request: { params: IdParam },
    responses: {
      201: {
        content: { 'application/json': { schema: DoseSchema } },
        description: 'PRN dose prepared for administration',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'PRN schedule unavailable or a dose is already pending',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const [schedule] = await getMedicationSchedule(id);
    if (
      !schedule ||
      !hasPermission(user, 'clinical.nurse') ||
      !(await canAccessAdmission(user, schedule.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await preparePrnDose(id, user.id);
    if (!result)
      return c.json({ error: 'PRN schedule unavailable or a dose is already pending' }, 409);
    return c.json(result, 201);
  },
);

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}/mar',
    tags: ['Medication Administration'],
    request: { params: IdParam },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.array(
              z.object({
                schedule: ScheduleSchema,
                doses: z.array(DoseSchema),
                latest_allergy_review: ReviewSchema.nullable(),
              }),
            ),
          },
        },
        description: 'Medication administration record',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessAdmission(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const schedules = await listMedicationSchedules(id);
    const ids = schedules.map((schedule) => schedule.id);
    const doses = ids.length ? await listMedicationDoses(ids) : [];
    const reviews = ids.length ? await listLatestAllergyReviews(ids) : [];
    return c.json(
      schedules.map((schedule) => ({
        schedule,
        doses: doses.filter((dose) => dose.schedule_id === schedule.id),
        latest_allergy_review: reviews.find((review) => review.schedule_id === schedule.id) ?? null,
      })),
      200,
    );
  },
);

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'post',
    path: '/medication-doses/{id}/give',
    tags: ['Medication Administration'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: GiveBody } } } },
    responses: {
      200: { content: { 'application/json': { schema: DoseSchema } }, description: 'Dose given' },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description:
          'Five-rights, active prescription, current allergy review, or dose state check failed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [existing] = await getDoseAdmission(id);
    if (
      !existing ||
      !hasPermission(user, 'clinical.nurse') ||
      !(await canAccessAdmission(user, existing.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await giveMedicationDose(id, body, user.id);
    if (!result)
      return c.json(
        { error: 'five-rights, current allergy review, order, timing, or dose state check failed' },
        409,
      );
    return c.json(result, 200);
  },
);

for (const action of ['hold', 'missed'] as const) {
  medicationAdministrationRouter.openapi(
    createRoute({
      method: 'post',
      path: `/medication-doses/{id}/${action}`,
      tags: ['Medication Administration'],
      request: { params: IdParam, body: { content: { 'application/json': { schema: HoldBody } } } },
      responses: {
        200: {
          content: { 'application/json': { schema: DoseSchema } },
          description: 'Dose held or marked missed and doctor notified',
        },
        403: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Nurse access required',
        },
        409: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Dose not scheduled or admission inactive',
        },
      },
    }),
    async (c) => {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const [existing] = await getDoseAdmission(id);
      if (
        !existing ||
        !hasPermission(user, 'clinical.nurse') ||
        !(await canAccessAdmission(user, existing.admission_id))
      )
        return c.json({ error: 'not found or forbidden' }, 403);
      const result = await recordDoseException(
        action,
        user.id,
        body.reason,
        id,
        existing.admission_id,
      );
      if (!result) return c.json({ error: 'dose not scheduled or admission inactive' }, 409);
      return c.json(result, 200);
    },
  );
}

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/medication-schedules/{id}/infusions',
    tags: ['Medication Administration'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(InfusionSchema) } },
        description: 'Infusion event history',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const [schedule] = await getMedicationSchedule(id);
    if (!schedule || !(await canAccessAdmission(c.get('user'), schedule.admission_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listInfusionEvents(id), 200);
  },
);

medicationAdministrationRouter.openapi(
  createRoute({
    method: 'post',
    path: '/medication-schedules/{id}/infusions',
    tags: ['Medication Administration'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: InfusionBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: InfusionSchema } },
        description: 'Infusion event recorded',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurse access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Identity, prescription, allergy, or infusion state check failed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [schedule] = await getMedicationSchedule(id);
    if (
      !schedule ||
      !hasPermission(user, 'clinical.nurse') ||
      !(await canAccessAdmission(user, schedule.admission_id))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await recordInfusionEvent(id, body, user.id);
    if (!result)
      return c.json(
        { error: 'identity, prescription, allergy, or infusion state check failed' },
        409,
      );
    return c.json(result, 201);
  },
);
