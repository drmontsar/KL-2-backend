import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { listAdmissionsByPatient } from '../db/queries/admissions';
import { listDiagnoses } from '../db/queries/diagnoses';
import {
  createPatient,
  getPatientById,
  listPatients,
  updatePatient,
} from '../db/queries/patients';
import {
  AdmissionSchema,
  DiagnosisSchema,
  ErrorSchema,
  IdParam,
  PatientSchema,
} from './schemas';

const AllergyEntrySchema = z.object({
  allergen: z.string(),
  reaction: z.string().optional(),
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
});

const CreatePatientBody = z.object({
  name: z.string(),
  dob: z.string(),
  sex: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  blood_group: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  abha_id: z.string().optional(),
  allergies: z.array(AllergyEntrySchema).optional(),
  created_by: z.string().uuid().optional(),
});

const UpdatePatientBody = z.object({
  expected_revision: z.number().int().positive(),
  name: z.string().optional(),
  dob: z.string().optional(),
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

export const patientsRouter = new OpenAPIHono();

patientsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Patients'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(PatientSchema) } },
        description: 'List of patients',
      },
    },
  }),
  async (c) => {
    const patients = await listPatients();
    return c.json(patients, 200);
  }
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
      201: {
        content: { 'application/json': { schema: PatientSchema } },
        description: 'Patient created',
      },
    },
  }),
  async (c) => {
    const data = c.req.valid('json');
    const patient = await createPatient(data);
    return c.json(patient, 201);
  }
);

patientsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Patients'],
    request: { params: IdParam },
    responses: {
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
    const patient = await getPatientById(id);
    if (!patient) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(patient, 200);
  }
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
    const { expected_revision, ...data } = c.req.valid('json');
    const result = await updatePatient(id, data, expected_revision);
    if (result === 'conflict') {
      return c.json({ error: 'revision conflict' }, 409);
    }
    if (!result) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(result, 200);
  }
);

patientsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/admissions',
    tags: ['Patients'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(AdmissionSchema) } },
        description: 'Patient admissions',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const admissions = await listAdmissionsByPatient(id);
    return c.json(admissions, 200);
  }
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
      200: {
        content: { 'application/json': { schema: z.array(DiagnosisSchema) } },
        description: 'Patient diagnoses',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('query');
    const diagnoses = await listDiagnoses(id, status);
    return c.json(diagnoses, 200);
  }
);
