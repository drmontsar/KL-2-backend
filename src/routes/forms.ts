import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import {
  DetailSchema,
  InstanceBody,
  InstanceSchema,
  SaveBody,
  SignBody,
  SignatureSchema,
  TemplateBody,
  TemplateSchema,
  VersionSchema,
} from '../contracts/forms';
import {
  canAccessFormVersion,
  createFormInstance,
  createFormTemplate,
  createFormVersion,
  finalizeForm,
  getFormInstance,
  getFormVersion,
  listFormSignatures,
  listFormTemplates,
  listFormVersions,
  listPatientForms,
  saveFormDraft,
  signFormField,
} from '../db/queries/forms';

import { ErrorSchema, IdParam } from '../contracts/common';
import { canAccessAdmission, canAccessPatient } from '../db/queries/access';
import type { User } from '../db/queries/users';

type Variables = { user: User };

export const formsRouter = new OpenAPIHono<{ Variables: Variables }>();

formsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/templates',
    tags: ['Forms'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(TemplateSchema) } },
        description: 'Form template library',
      },
    },
  }),
  async (c) => {
    const rows = await listFormTemplates();
    return c.json(rows, 200);
  },
);

formsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/templates',
    tags: ['Forms'],
    request: { body: { content: { 'application/json': { schema: TemplateBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: TemplateSchema } },
        description: 'Synthetic form template created',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Doctor access required',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);
    const row = await createFormTemplate(body, user.id);
    return c.json(row, 201);
  },
);

formsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/instances',
    tags: ['Forms'],
    request: { body: { content: { 'application/json': { schema: InstanceBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: VersionSchema } },
        description: 'Draft instance with autofill snapshot',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Template or admission unavailable',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (
      !(await canAccessPatient(user, body.patient_id)) ||
      (body.admission_id && !(await canAccessAdmission(user, body.admission_id)))
    )
      return c.json({ error: 'not found or forbidden' }, 403);
    const version = await createFormInstance(body, user.id);
    if (!version) return c.json({ error: 'template or admission unavailable' }, 409);
    return c.json(version, 201);
  },
);

formsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/patients/{id}/instances',
    tags: ['Forms'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(InstanceSchema) } },
        description: 'Forms associated with a patient',
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
    return c.json(await listPatientForms(id), 200);
  },
);

formsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/instances/{id}/versions',
    tags: ['Forms'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(VersionSchema) } },
        description: 'Form version history',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const [instance] = await getFormInstance(id);
    if (!instance || !(await canAccessPatient(c.get('user'), instance.patient_id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listFormVersions(id), 200);
  },
);

formsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/versions/{id}',
    tags: ['Forms'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: DetailSchema } },
        description: 'Form version and captured signatures',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessFormVersion(c.get('user'), id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const [version] = await getFormVersion(id);
    const signatures = await listFormSignatures(id);
    return c.json({ version, signatures }, 200);
  },
);

formsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/versions/{id}',
    tags: ['Forms'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: SaveBody } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: VersionSchema } },
        description: 'Draft saved; captured signatures are cleared',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Final version, revision conflict, or invalid field values',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!(await canAccessFormVersion(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await saveFormDraft(id, body, user.id);
    if (!result)
      return c.json({ error: 'final version, revision conflict, or invalid field values' }, 409);
    return c.json(result, 200);
  },
);

formsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/versions/{id}/signatures',
    tags: ['Forms'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: SignBody } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: SignatureSchema } },
        description: 'Demo signature captured',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or signer not authorized',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Version not draft or field already signed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!(await canAccessFormVersion(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);

    const result = await signFormField(id, body, user);
    if (result === 'forbidden') return c.json({ error: 'signer not authorized' }, 403);
    if (!result) return c.json({ error: 'version not draft' }, 409);
    return c.json(result, 201);
  },
);

formsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/versions/{id}/finalize',
    tags: ['Forms'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: VersionSchema } },
        description: 'Form finalized and locked',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Missing required fields or signatures',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (!(await canAccessFormVersion(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await finalizeForm(id, user.id);
    if (!result)
      return c.json(
        { error: 'missing required fields or signatures, or version already final' },
        409,
      );
    return c.json(result, 200);
  },
);

formsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/versions/{id}/new-version',
    tags: ['Forms'],
    request: { params: IdParam },
    responses: {
      201: {
        content: { 'application/json': { schema: VersionSchema } },
        description: 'New draft version; signatures cleared',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Version not final or newer version already exists',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (!(await canAccessFormVersion(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const result = await createFormVersion(id, user.id);
    if (!result) return c.json({ error: 'version not final or newer version already exists' }, 409);
    return c.json(result, 201);
  },
);
