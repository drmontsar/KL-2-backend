import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import {
  AdmissionHandoffBody,
  AdmissionHandoffSchema,
  ChargeSchema,
  CheckinBody,
  DiagnosisSchema,
  DispatchDetailSchema,
  DispatchQuery,
  DispatchSchema,
  DraftBody,
  InvestigationSchema,
  OPDPatientSchema,
  PrescriptionBody,
  PrescriptionSchema,
  QueueVisitSchema,
  SearchQuery,
  SelectCode,
  SelectionSchema,
  TriageBody,
  VisitSchema,
} from '../contracts/opd';
import {
  signOpdVisit,
  completeOpdDispatch,
  getOpdDispatch,
  checkInPatient,
  addOpdSelection,
  requestOpdAdmission,
  prescribeMedication,
  removeOpdPrescription,
  searchDiagnosisCatalog,
  listOpdDispatches,
  listInvestigationCatalog,
  listOpdQueue,
  listOpdCharges,
  listOpdDiagnoses,
  listOpdInvestigations,
  getOpdPatient,
  listOpdPrescriptions,
  getOpdVisit,
  saveOpdVisit,
} from '../db/queries/opd';

import { ErrorSchema, IdParam } from '../contracts/common';
import { canAccessPatient } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const opdRouter = new OpenAPIHono<{ Variables: Variables }>();

opdRouter.openapi(
  createRoute({
    method: 'post',
    path: '/check-ins',
    tags: ['OPD'],
    request: { body: { content: { 'application/json': { schema: CheckinBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: VisitSchema } },
        description: 'Patient checked in',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (
      !hasPermission(user, 'patients.register') ||
      (body.patient_id && !(await canAccessPatient(user, body.patient_id)))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const visit = await checkInPatient(body, user.id);
    return c.json(visit, 201);
  },
);

opdRouter.openapi(
  createRoute({
    method: 'get',
    path: '/queue',
    tags: ['OPD'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(QueueVisitSchema) } },
        description: 'OPD queue and patient summaries for clinical staff',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Clinical access required',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.doctor') && !hasPermission(user, 'clinical.nurse'))
      return c.json({ error: 'clinical access required' }, 403);
    const rows = await listOpdQueue();
    return c.json(rows, 200);
  },
);

opdRouter.openapi(
  createRoute({
    method: 'get',
    path: '/visits/{id}',
    tags: ['OPD'],
    request: { params: IdParam },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({
              visit: VisitSchema,
              patient: OPDPatientSchema,
              diagnoses: z.array(SelectionSchema),
              investigations: z.array(SelectionSchema),
              prescriptions: z.array(PrescriptionSchema),
              charges: ChargeSchema.nullable(),
            }),
          },
        },
        description: 'Visit details',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Clinical access required',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Visit not found',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (!hasPermission(user, 'clinical.doctor') && !hasPermission(user, 'clinical.nurse'))
      return c.json({ error: 'clinical access required' }, 403);
    const [visit] = await getOpdVisit(id);
    if (!visit) return c.json({ error: 'visit not found' }, 404);
    const [patient] = await getOpdPatient(visit.patient_id);
    const [diagnoses, investigations, prescriptions, charges] = await Promise.all([
      listOpdDiagnoses(id),
      listOpdInvestigations(id),
      listOpdPrescriptions(id),
      listOpdCharges(id),
    ]);
    return c.json(
      { visit, patient, diagnoses, investigations, prescriptions, charges: charges[0] ?? null },
      200,
    );
  },
);

opdRouter.openapi(
  createRoute({
    method: 'get',
    path: '/dispatches',
    tags: ['OPD'],
    request: { query: DispatchQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(DispatchDetailSchema) } },
        description: 'Synthetic pharmacy and collection dispatches',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Clinical or pharmacy access required',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const query = c.req.valid('query');
    const pharmacy = user.job_role === 'administrator' || user.job_role === 'pharmacist';
    const collection =
      user.job_role === 'administrator' || user.role === 'nurse' || user.role === 'doctor';
    if (!pharmacy && !collection)
      return c.json({ error: 'clinical or pharmacy access required' }, 403);
    const rows = await listOpdDispatches(pharmacy, collection, query);
    return c.json(rows, 200);
  },
);

opdRouter.openapi(
  createRoute({
    method: 'post',
    path: '/dispatches/{id}/complete',
    tags: ['OPD'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: DispatchSchema } },
        description: 'Synthetic dispatch marked completed',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Dispatch already completed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const [existing] = await getOpdDispatch(id);
    const permitted =
      existing?.kind === 'pharmacy'
        ? user.job_role === 'administrator' || user.job_role === 'pharmacist'
        : user.job_role === 'administrator' || user.role === 'doctor' || user.role === 'nurse';
    if (!existing || !permitted) return c.json({ error: 'not found or forbidden' }, 403);
    const result = await completeOpdDispatch(user.id, id);
    if (!result) return c.json({ error: 'dispatch already completed' }, 409);
    return c.json(result, 200);
  },
);

opdRouter.openapi(
  createRoute({
    method: 'get',
    path: '/diagnoses',
    tags: ['OPD'],
    request: { query: SearchQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(DiagnosisSchema) } },
        description: 'Synthetic diagnosis catalogue',
      },
    },
  }),
  async (c) => {
    const { q } = c.req.valid('query');
    return c.json(await searchDiagnosisCatalog(q), 200);
  },
);

opdRouter.openapi(
  createRoute({
    method: 'get',
    path: '/investigations',
    tags: ['OPD'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(InvestigationSchema) } },
        description: 'Synthetic investigation catalogue',
      },
    },
  }),
  async (c) => c.json(await listInvestigationCatalog(), 200),
);

for (const action of ['triage', 'draft'] as const) {
  opdRouter.openapi(
    createRoute({
      method: 'patch',
      path: `/visits/{id}/${action}`,
      tags: ['OPD'],
      request: {
        params: IdParam,
        body: {
          content: { 'application/json': { schema: action === 'triage' ? TriageBody : DraftBody } },
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: VisitSchema } },
          description: 'Visit updated',
        },
        403: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Clinical access required',
        },
        409: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Visit closed or revision changed',
        },
      },
    }),
    async (c) => {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      if (
        action === 'triage'
          ? !hasPermission(user, 'clinical.nurse') && !hasPermission(user, 'clinical.doctor')
          : !hasPermission(user, 'clinical.doctor')
      )
        return c.json({ error: 'clinical access required' }, 403);
      const body = c.req.valid('json');
      const row = await saveOpdVisit(action, body, id, user.id);
      if (!row) return c.json({ error: 'visit closed or revision changed' }, 409);
      return c.json(row, 200);
    },
  );
}

for (const action of ['diagnoses', 'investigations'] as const) {
  opdRouter.openapi(
    createRoute({
      method: 'post',
      path: `/visits/{id}/${action}`,
      tags: ['OPD'],
      request: {
        params: IdParam,
        body: { content: { 'application/json': { schema: SelectCode } } },
      },
      responses: {
        201: {
          content: {
            'application/json': {
              schema: z.object({
                id: z.string().uuid(),
                visit_id: z.string().uuid(),
                code: z.string(),
              }),
            },
          },
          description: 'Selection added',
        },
        403: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Doctor access required',
        },
        409: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Visit closed, unknown code or duplicate selection',
        },
      },
    }),
    async (c) => {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      const { code } = c.req.valid('json');
      if (!hasPermission(user, 'clinical.doctor'))
        return c.json({ error: 'doctor access required' }, 403);

      const result = await addOpdSelection(id, action, code, user.id);
      if (!result) return c.json({ error: 'visit closed or code unknown' }, 409);
      return c.json(result, 201);
    },
  );
}

opdRouter.openapi(
  createRoute({
    method: 'post',
    path: '/visits/{id}/prescriptions',
    tags: ['OPD'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: PrescriptionBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: PrescriptionSchema } },
        description: 'Prescription added',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Visit closed, medication unavailable or allergy override required',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);
    const result = await prescribeMedication(id, body, user.id);
    if (!result)
      return c.json(
        { error: 'visit closed, medication unavailable or allergy override required' },
        409,
      );
    return c.json(result, 201);
  },
);

opdRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/visits/{id}/prescriptions/{prescriptionId}',
    tags: ['OPD'],
    request: { params: z.object({ id: z.string().uuid(), prescriptionId: z.string().uuid() }) },
    responses: {
      200: {
        content: { 'application/json': { schema: PrescriptionSchema } },
        description: 'Draft prescription removed',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Visit closed or prescription not found',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, prescriptionId } = c.req.valid('param');
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);
    const result = await removeOpdPrescription(id, prescriptionId, user.id);
    if (!result) return c.json({ error: 'visit closed or prescription not found' }, 409);
    return c.json(result, 200);
  },
);

opdRouter.openapi(
  createRoute({
    method: 'post',
    path: '/visits/{id}/admission-request',
    tags: ['OPD'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: AdmissionHandoffBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: AdmissionHandoffSchema } },
        description: 'Signed OPD visit handed to admission intake',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Visit not signed for admission, unit unavailable, or request exists',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);

    const result = await requestOpdAdmission(id, user, body);
    if (!result) return c.json({ error: 'visit is not signed for admission' }, 409);
    return c.json(result, 201);
  },
);

opdRouter.openapi(
  createRoute({
    method: 'post',
    path: '/visits/{id}/close',
    tags: ['OPD'],
    request: { params: IdParam },
    responses: {
      200: {
        content: {
          'application/json': { schema: z.object({ visit: VisitSchema, charges: ChargeSchema }) },
        },
        description: 'Signed visit and calculated charges',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Visit closed or required note missing',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);
    const result = await signOpdVisit(user.id, id);
    if (!result) return c.json({ error: 'visit closed or required note missing' }, 409);
    return c.json(result, 200);
  },
);
