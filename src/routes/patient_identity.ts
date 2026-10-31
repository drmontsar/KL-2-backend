import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import { ErrorSchema, IdParam, PatientSchema } from '../contracts/common';
import { canAccessAdmission, canAccessPatient } from '../db/queries/access';
import {
  addCoverage,
  addNextOfKin,
  addPatientContact,
  addPatientIdentifier,
  findDuplicateCandidates,
  getPatientIdentity,
  listBedAssignmentHistory,
  searchPatientsForUser,
} from '../db/queries/patient_identity';
import type { User } from '../db/queries/users';

const IdentifierSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  type: z.enum(['uhid', 'abha', 'mrn', 'external']),
  value: z.string(),
  issuer: z.string().nullable(),
  created_at: z.string(),
});
const ContactSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  type: z.enum(['phone', 'email', 'address']),
  label: z.string().nullable(),
  value: z.string(),
  is_primary: z.boolean(),
  created_at: z.string(),
});
const NextOfKinSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  name: z.string(),
  relationship: z.string(),
  phone: z.string(),
  address: z.string().nullable(),
  is_primary: z.boolean(),
  created_at: z.string(),
});
const CoverageSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  payer_name: z.string(),
  policy_number: z.string(),
  member_id: z.string().nullable(),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  is_primary: z.boolean(),
  created_at: z.string(),
});
const IdentitySchema = z.object({
  identifiers: z.array(IdentifierSchema),
  contacts: z.array(ContactSchema),
  next_of_kin: z.array(NextOfKinSchema),
  coverage: z.array(CoverageSchema),
});
const BedAssignmentSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  bed_id: z.string().uuid(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  assigned_by: z.string().uuid().nullable(),
  end_reason: z.string().nullable(),
  ward_name: z.string(),
  room_name: z.string(),
  bed_label: z.string(),
});
const SearchQuery = z.object({
  q: z.string().trim().min(2),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const DuplicateBody = z.object({
  name: z.string().trim().min(2),
  dob: z.string().date(),
  phone: z.string().optional(),
  abha_id: z.string().optional(),
});
const DuplicateSchema = z.object({
  id: z.string().uuid(),
  uhid: z.string(),
  name: z.string(),
  dob: z.string(),
  phone: z.string().nullable(),
  abha_id: z.string().nullable(),
});
const IdentifierBody = z.object({
  type: z.enum(['abha', 'mrn', 'external']),
  value: z.string().trim().min(1),
  issuer: z.string().optional(),
});
const ContactBody = z.object({
  type: z.enum(['phone', 'email', 'address']),
  label: z.string().optional(),
  value: z.string().trim().min(1),
  is_primary: z.boolean().default(false),
});
const NextOfKinBody = z.object({
  name: z.string().trim().min(1),
  relationship: z.string().trim().min(1),
  phone: z.string().trim().min(6),
  address: z.string().optional(),
  is_primary: z.boolean().default(false),
});
const CoverageBody = z
  .object({
    payer_name: z.string().trim().min(1),
    policy_number: z.string().trim().min(1),
    member_id: z.string().optional(),
    valid_from: z.string().date().optional(),
    valid_until: z.string().date().optional(),
    is_primary: z.boolean().default(false),
  })
  .refine(
    (body) => !body.valid_from || !body.valid_until || body.valid_until >= body.valid_from,
    'valid_until must not be earlier than valid_from',
  );

type Variables = { user: User };
export const patientIdentityRouter = new OpenAPIHono<{ Variables: Variables }>();

patientIdentityRouter.openapi(
  createRoute({
    method: 'get',
    path: '/patients/search',
    tags: ['Patient Identity'],
    request: { query: SearchQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(PatientSchema) } },
        description: 'Role-scoped patient search',
      },
    },
  }),
  async (c) => {
    const { q, limit } = c.req.valid('query');
    return c.json(await searchPatientsForUser(q, c.get('user'), limit), 200);
  },
);

patientIdentityRouter.openapi(
  createRoute({
    method: 'post',
    path: '/patients/duplicate-candidates',
    tags: ['Patient Identity'],
    request: { body: { content: { 'application/json': { schema: DuplicateBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(DuplicateSchema) } },
        description: 'Possible duplicate patients',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Registration access required',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'patients.register'))
      return c.json({ error: 'patient-registration access required' }, 403);
    return c.json(await findDuplicateCandidates(c.req.valid('json'), user), 200);
  },
);

patientIdentityRouter.openapi(
  createRoute({
    method: 'get',
    path: '/patients/{id}/identity',
    tags: ['Patient Identity'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: IdentitySchema } },
        description: 'Patient identifiers, contacts, next of kin, and coverage',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessPatient(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await getPatientIdentity(id), 200);
  },
);

patientIdentityRouter.openapi(
  createRoute({
    method: 'post',
    path: '/patients/{id}/identifiers',
    tags: ['Patient Identity'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: IdentifierBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: IdentifierSchema } },
        description: 'Identifier added',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Identifier already exists',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (!hasPermission(user, 'patients.register') || !(await canAccessPatient(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(
      await addPatientIdentifier({
        patient_id: id,
        ...c.req.valid('json'),
        actor_user_id: user.id,
      }),
      201,
    );
  },
);

patientIdentityRouter.openapi(
  createRoute({
    method: 'post',
    path: '/patients/{id}/contacts',
    tags: ['Patient Identity'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: ContactBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: ContactSchema } },
        description: 'Contact added',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (!hasPermission(user, 'patients.register') || !(await canAccessPatient(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(
      await addPatientContact({ patient_id: id, ...c.req.valid('json'), actor_user_id: user.id }),
      201,
    );
  },
);

patientIdentityRouter.openapi(
  createRoute({
    method: 'post',
    path: '/patients/{id}/next-of-kin',
    tags: ['Patient Identity'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: NextOfKinBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: NextOfKinSchema } },
        description: 'Next of kin added',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (!hasPermission(user, 'patients.register') || !(await canAccessPatient(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const body = c.req.valid('json');
    return c.json(
      await addNextOfKin({
        patient_id: id,
        ...body,
        address: body.address ?? null,
        actor_user_id: user.id,
      }),
      201,
    );
  },
);

patientIdentityRouter.openapi(
  createRoute({
    method: 'post',
    path: '/patients/{id}/coverage',
    tags: ['Patient Identity'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: CoverageBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: CoverageSchema } },
        description: 'Coverage added',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Policy already exists',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (!hasPermission(user, 'patients.register') || !(await canAccessPatient(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const body = c.req.valid('json');

    return c.json(
      await addCoverage({
        patient_id: id,
        ...body,
        member_id: body.member_id ?? null,
        valid_from: body.valid_from ?? null,
        valid_until: body.valid_until ?? null,
        actor_user_id: user.id,
      }),
      201,
    );
  },
);

patientIdentityRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}/bed-history',
    tags: ['Patient Identity'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(BedAssignmentSchema) } },
        description: 'Bed assignment history',
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
    return c.json(await listBedAssignmentHistory(id), 200);
  },
);
