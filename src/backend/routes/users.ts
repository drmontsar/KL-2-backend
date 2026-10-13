import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  createUser,
  disableUser,
  getUserById,
  listUsers,
} from '../db/queries/users';
import { ErrorSchema, IdParam, UserSchema } from './schemas';

const CreateUserBody = z.object({
  name: z.string(),
  role: z.enum(['doctor', 'nurse', 'admin']),
  registration_number: z.string().optional(),
  specialization: z.string().optional(),
  phone: z.string().optional(),
});

export const usersRouter = new OpenAPIHono();

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
