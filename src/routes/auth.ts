import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { config } from '../config';
import { ErrorSchema, UserSchema } from '../contracts/common';
import { createSession, deleteSession, getUserByPhone } from '../db/queries/auth';
import { createUser } from '../db/queries/users';
import { logger } from '../logger';

const RequestBody = z.object({
  phone: z.string().min(6),
  name: z.string().trim().min(1).optional(),
  role: z.enum(['doctor', 'nurse', 'consultant']).optional(),
});

const VerifyBody = z.object({
  phone: z.string().min(1),
  otp: z.string().min(1),
  shift: z.enum(['morning', 'afternoon', 'night']).optional(),
});

const AuthResponse = z.object({
  token: z.string(),
  user: UserSchema,
  shift: z.enum(['morning', 'afternoon', 'night']).optional(),
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
      503: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Authentication provider not configured',
      },
      200: {
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
        description: 'OTP ready',
      },
    },
  }),
  async (c) => {
    if (!['development', 'test'].includes(config.nodeEnv))
      return c.json({ error: 'authentication unavailable' }, 503);
    const { phone, name, role } = c.req.valid('json');
    const user = await getUserByPhone(phone);
    if (!user && config.nodeEnv !== 'production' && name && role) {
      await createUser({
        phone,
        name,
        role: role === 'consultant' ? 'doctor' : role,
        ...(role === 'consultant' ? { job_role: 'consultant' } : {}),
      });
    }
    logger.info('OTP request accepted (development verifier only)');
    return c.json({ message: 'OTP sent' }, 200);
  },
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
      503: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Authentication provider not configured',
      },
      401: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Phone not registered',
      },
    },
  }),
  async (c) => {
    if (!['development', 'test'].includes(config.nodeEnv))
      return c.json({ error: 'authentication unavailable' }, 503);
    const { phone, shift } = c.req.valid('json');
    const user = await getUserByPhone(phone);
    if (!user) {
      return c.json({ error: 'phone not registered' }, 401);
    }
    if (shift && user.job_role !== 'duty_doctor')
      return c.json({ error: 'shift selection is only for duty doctors' }, 401);
    // Development-only until a real OTP provider is integrated.
    const token = await createSession(user.id, shift);
    return c.json({ token, user, ...(shift ? { shift } : {}) }, 200);
  },
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
  },
);
