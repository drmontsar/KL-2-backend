import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  createSession,
  deleteSession,
  getUserByPhone,
  upsertUserByPhone,
} from '../db/queries/auth';
import { logger } from '../logger';
import { ErrorSchema, UserSchema } from './schemas';

const RequestBody = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  role: z.enum(['doctor', 'nurse']),
});

const VerifyBody = z.object({
  phone: z.string().min(1),
  otp: z.string().min(1),
});

const AuthResponse = z.object({
  token: z.string(),
  user: UserSchema,
});

export const authRouter = new OpenAPIHono();

authRouter.openapi(
  createRoute({
    method: 'post',
    path: '/request',
    tags: ['Auth'],
    request: {
      body: { content: { 'application/json': { schema: RequestBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
        description: 'OTP ready',
      },
    },
  }),
  async (c) => {
    const { name, phone, role } = c.req.valid('json');
    await upsertUserByPhone({ name, phone, role });
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    logger.info({ phone, otp }, 'OTP (dev only — replace with SMS in prod)');
    return c.json({ message: 'OTP sent' }, 200);
  }
);

authRouter.openapi(
  createRoute({
    method: 'post',
    path: '/verify',
    tags: ['Auth'],
    request: {
      body: { content: { 'application/json': { schema: VerifyBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: AuthResponse } },
        description: 'Authenticated',
      },
      401: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Phone not registered',
      },
    },
  }),
  async (c) => {
    const { phone } = c.req.valid('json');
    const user = await getUserByPhone(phone);
    if (!user) {
      return c.json({ error: 'phone not registered' }, 401);
    }
    // OTP is fake — any value passes in this phase
    const token = await createSession(user.id);
    return c.json({ token, user }, 200);
  }
);

authRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/session',
    tags: ['Auth'],
    responses: {
      204: { description: 'Logged out' },
      401: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'No session',
      },
    },
  }),
  async (c) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await deleteSession(header.slice(7));
    return c.body(null, 204);
  }
);
