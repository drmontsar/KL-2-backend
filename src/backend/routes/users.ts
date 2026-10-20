import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  createUser,
  disableUser,
  getUserById,
  listUsers,
  setDoctorArea,
  listActiveDoctors,
} from '../db/queries/users';
import type { User } from '../db/queries/users';
import { DoctorPresenceSchema, ErrorSchema, IdParam, UserSchema } from './schemas';

type Variables = { user: User };

const CreateUserBody = z.object({
  name: z.string(),
  role: z.enum(['doctor', 'nurse', 'admin']),
  registration_number: z.string().optional(),
  specialization: z.string().optional(),
  phone: z.string().optional(),
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
      200: {
        content: { 'application/json': { schema: z.array(UserSchema) } },
        description: 'List of active users',
      },
    },
  }),
  async (c) => {
    const { role } = c.req.valid('query');
    const users = await listUsers(role);
    return c.json(users, 200);
  }
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
      201: {
        content: { 'application/json': { schema: UserSchema } },
        description: 'User created',
      },
    },
  }),
  async (c) => {
    const data = c.req.valid('json');
    const user = await createUser(data);
    return c.json(user, 201);
  }
);

usersRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Users'],
    request: { params: IdParam },
    responses: {
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
    const user = await getUserById(id);
    if (!user) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(user, 200);
  }
);

usersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/disable',
    tags: ['Users'],
    request: { params: IdParam },
    responses: {
      204: { description: 'User disabled' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await disableUser(id);
    return c.body(null, 204);
  }
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
      200: {
        content: { 'application/json': { schema: UserSchema } },
        description: 'Area updated',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Only doctors can set area',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.role !== 'doctor') return c.json({ error: 'only doctors can set area' }, 403);
    const { area } = c.req.valid('json');
    const updated = await setDoctorArea(user.id, area);
    return c.json(updated!, 200);
  }
);

usersRouter.openapi(
  createRoute({
    method: 'get',
    path: '/doctors/active',
    tags: ['Users'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(DoctorPresenceSchema) } },
        description: 'Doctors currently on shift with online status',
      },
    },
  }),
  async (c) => {
    const doctors = await listActiveDoctors();
    return c.json(doctors, 200);
  }
);
