import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import {
  AdmissionSchema,
  DiagnosisSchema,
  ErrorSchema,
  IdParam,
  PatientSchema,
} from '../contracts/common';
import { canAccessPatient } from '../db/queries/access';
import { listAdmissionsByPatient } from '../db/queries/admissions';
import { listDiagnoses } from '../db/queries/diagnoses';
import {
  createPatient,
  getPatientById,
  listPatientsForUser,
  updatePatient,
} from '../db/queries/patients';
import type { User } from '../db/queries/users';

const AllergyEntrySchema = z.object({
  allergen: z.string().trim().min(1).max(200),
  reaction: z.string().optional(),
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
});

const DateOfBirth = z
  .string()
  .date()
  .refine(
    (date) => date <= new Date().toISOString().slice(0, 10),
    'date of birth cannot be in the future',
  );

const CreatePatientBody = z.object({
  name: z.string().trim().min(1).max(200),
  dob: DateOfBirth,
  sex: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  blood_group: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  abha_id: z.string().optional(),
  allergies: z.array(AllergyEntrySchema).optional(),
});

const UpdatePatientBody = z.object({
  expected_revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  dob: DateOfBirth.optional(),
  sex: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  blood_group: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  abha_id: z.string().optional(),
  allergies: z.array(AllergyEntrySchema).optional(),
});

const DiagnosisStatusQuery = z.object({
  status: z.enum(['active', 'resolved']).optional(),
});

type Variables = { user: User };

export const patientsRouter = new OpenAPIHono<{ Variables: Variables }>();

patientsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Patients'],
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(PatientSchema) } },
        description: 'List of patients',
      },
    },
  }),
  async (c) => {
    const patients = await listPatientsForUser(c.get('user'));
    return c.json(patients, 200);
  },
);

patientsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Patients'],
    request: {
      body: { content: { 'application/json': { schema: CreatePatientBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: PatientSchema } },
        description: 'Patient created',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Patient identifier already exists',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'patients.register'))
      return c.json({ error: 'patient-registration access required' }, 403);
    const data = c.req.valid('json');

    const patient = await createPatient({ ...data, created_by: user.id });
    return c.json(patient, 201);
  },
);

patientsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Patients'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: PatientSchema } },
        description: 'Patient found',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessPatient(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const patient = await getPatientById(id);
    if (!patient) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(patient, 200);
  },
);

patientsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Patients'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: UpdatePatientBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: PatientSchema } },
        description: 'Patient updated',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Revision conflict — re-fetch and retry',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!hasPermission(user, 'patients.register') || !(await canAccessPatient(user, id))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const { expected_revision, ...data } = c.req.valid('json');

    const result = await updatePatient(id, data, expected_revision, user.id);
    if (result === 'conflict') return c.json({ error: 'revision conflict' }, 409);
    if (!result) return c.json({ error: 'not found' }, 404);
    return c.json(result, 200);
  },
);

patientsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/admissions',
    tags: ['Patients'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(AdmissionSchema) } },
        description: 'Patient admissions',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessPatient(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const admissions = await listAdmissionsByPatient(id, c.get('user'));
    return c.json(admissions, 200);
  },
);

patientsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/diagnoses',
    tags: ['Patients'],
    request: {
      params: IdParam,
      query: DiagnosisStatusQuery,
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(DiagnosisSchema) } },
        description: 'Patient diagnoses',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessPatient(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const { status } = c.req.valid('query');
    const diagnoses = await listDiagnoses(id, status);
    return c.json(diagnoses, 200);
  },
);
