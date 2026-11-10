import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import { DoctorPresenceSchema, ErrorSchema, IdParam, UserSchema } from '../contracts/common';
import type { User } from '../db/queries/users';
import { changePassword, setUserCredentials } from '../db/queries/auth';
import {
  createUser,
  disableUser,
  getUserById,
  listActiveDoctors,
  listUsers,
  setDoctorArea,
} from '../db/queries/users';

type Variables = { user: User };

const CreateUserBody = z.object({
  name: z.string().trim().min(1),
  role: z.enum(['doctor', 'nurse', 'admin']),
  job_role: z
    .enum([
      'duty_doctor',
      'consultant',
      'staff_nurse',
      'pharmacist',
      'billing_insurance',
      'bed_desk',
      'administrator',
    ])
    .optional(),
  registration_number: z.string().optional(),
  specialization: z.string().optional(),
  phone: z.string().trim().min(6).optional(),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

const CredentialsBody = CreateUserBody.pick({ email: true, password: true });
const ChangePasswordBody = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(12).max(128),
});

const SetAreaBody = z.object({
  area: z.string().max(50).nullable(),
});

export const usersRouter = new OpenAPIHono<{ Variables: Variables }>();

usersRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Users'],
    request: {
      query: z.object({
        role: z.enum(['doctor', 'nurse', 'admin']).optional(),
      }),
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(UserSchema) } },
        description: 'List of active users',
      },
    },
  }),
  async (c) => {
    const viewer = c.get('user');
    const { role } = c.req.valid('query');
    const users = await listUsers(role);
    return c.json(
      hasPermission(viewer, 'staff.private.read')
        ? users
        : users.map((user) => ({ ...user, phone: null, email: null })),
      200,
    );
  },
);

usersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Users'],
    request: {
      body: { content: { 'application/json': { schema: CreateUserBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: UserSchema } },
        description: 'User created',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Phone or email already registered',
      },
    },
  }),
  async (c) => {
    if (!hasPermission(c.get('user'), 'users.manage'))
      return c.json({ error: 'admin access required' }, 403);
    const data = c.req.valid('json');
    const role = data.job_role
      ? ['duty_doctor', 'consultant'].includes(data.job_role)
        ? 'doctor'
        : data.job_role === 'staff_nurse'
          ? 'nurse'
          : 'admin'
      : data.role;
    const user = await createUser({ ...data, role });
    return c.json(user, 201);
  },
);

usersRouter.openapi(
  createRoute({
    method: 'put', path: '/{id}/credentials', tags: ['Users'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: CredentialsBody } } } },
    responses: {
      200: { content: { 'application/json': { schema: UserSchema } }, description: 'Credentials assigned; previous sessions revoked' },
      403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Admin access required' },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'User not found' },
      409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Email already in use' },
    },
  }),
  async (c) => {
    if (!hasPermission(c.get('user'), 'users.manage'))
      return c.json({ error: 'admin access required' }, 403);
    const { id } = c.req.valid('param');
    const { email, password } = c.req.valid('json');
    const user = await setUserCredentials(id, email, password, c.get('user').id);
    if (!user) return c.json({ error: 'user not found' }, 404);
    return c.json(user, 200);
  },
);

usersRouter.openapi(
  createRoute({
    method: 'post', path: '/me/password', tags: ['Users'],
    request: { body: { content: { 'application/json': { schema: ChangePasswordBody } } } },
    responses: {
      204: { description: 'Password changed; sessions revoked' },
      403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Current password incorrect' },
    },
  }),
  async (c) => {
    const { current_password, new_password } = c.req.valid('json');
    if (!(await changePassword(c.get('user').id, current_password, new_password)))
      return c.json({ error: 'current password incorrect' }, 403);
    return c.body(null, 204);
  },
);

usersRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Users'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: UserSchema } },
        description: 'User found',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'User not found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const viewer = c.get('user');
    if (!hasPermission(viewer, 'staff.private.read') && viewer.id !== id)
      return c.json({ error: 'not found or forbidden' }, 403);
    const user = await getUserById(id);
    if (!user) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(user, 200);
  },
);

usersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/disable',
    tags: ['Users'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      204: { description: 'User disabled' },
    },
  }),
  async (c) => {
    if (!hasPermission(c.get('user'), 'users.manage'))
      return c.json({ error: 'admin access required' }, 403);
    const { id } = c.req.valid('param');
    await disableUser(id);
    return c.body(null, 204);
  },
);

usersRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/me/area',
    tags: ['Users'],
    request: {
      body: { content: { 'application/json': { schema: SetAreaBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: UserSchema } },
        description: 'Area updated',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.role !== 'doctor') return c.json({ error: 'only doctors can set area' }, 403);
    const { area } = c.req.valid('json');
    const updated = await setDoctorArea(user.id, area);
    return c.json(updated!, 200);
  },
);

usersRouter.openapi(
  createRoute({
    method: 'get',
    path: '/doctors/active',
    tags: ['Users'],
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(DoctorPresenceSchema) } },
        description: 'Doctors currently on shift with online status',
      },
    },
  }),
  async (c) => {
    const viewer = c.get('user');
    const doctors = await listActiveDoctors();
    return c.json(
      hasPermission(viewer, 'staff.private.read')
        ? doctors
        : doctors.map((doctor) => ({ ...doctor, phone: null, email: null })),
      200,
    );
  },
);
