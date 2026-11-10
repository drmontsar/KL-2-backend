import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { ErrorSchema, UserSchema } from '../contracts/common';
import { authenticate, createSession, deleteSession, getSessionShift, selectSessionShift } from '../db/queries/auth';
import { authMiddleware } from '../middleware/auth';

const LoginBody = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
  shift: z.enum(['morning', 'afternoon', 'night']).optional(),
});

const AuthResponse = z.object({
  token: z.string(),
  user: UserSchema,
  shift: z.enum(['morning', 'afternoon', 'night']).optional(),
});

// Process-local login throttling; a shared gateway limit is needed for multiple replicas.
const failures = new Map<string, { count: number; expires: number }>();

export const authRouter = new OpenAPIHono<{ Variables: { user: z.infer<typeof UserSchema> } }>();

authRouter.openapi(
  createRoute({
    method: 'post', path: '/login', tags: ['Auth'],
    request: { body: { content: { 'application/json': { schema: LoginBody } } } },
    responses: {
      200: { content: { 'application/json': { schema: AuthResponse } }, description: 'Authenticated' },
      401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Invalid credentials' },
      429: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Too many attempts' },
    },
  }),
  async (c) => {
    const { email, password, shift } = c.req.valid('json');
    const now = Date.now();
    const attempt = failures.get(email);
    const user = await authenticate(email, password);
    if (!user) {
      const active = attempt && attempt.expires > now ? attempt.count : 0;
      if (failures.size > 10_000) failures.clear();
      failures.set(email, { count: active + 1, expires: now + 15 * 60_000 });
      // A valid password can still log in after failed attempts; never let an
      // attacker lock a clinician out by submitting bad passwords for them.
      if (active >= 10) return c.json({ error: 'too many login attempts; try later' }, 429);
      return c.json({ error: 'invalid credentials' }, 401);
    }
    failures.delete(email);
    if (shift && user.job_role !== 'duty_doctor')
      return c.json({ error: 'shift selection is only for duty doctors' }, 401);
    const token = await createSession(user.id, shift);
    return c.json({ token, user, ...(shift ? { shift } : {}) }, 200);
  },
);

const SessionResponse = z.object({ user: UserSchema, shift: z.enum(['morning', 'afternoon', 'night']).nullable() });
const ShiftBody = z.object({ shift: z.enum(['morning', 'afternoon', 'night']) });
authRouter.use('/session', authMiddleware);
authRouter.openapi(createRoute({
  method: 'get', path: '/session', tags: ['Auth'],
  responses: {
    200: { content: { 'application/json': { schema: SessionResponse } }, description: 'Authenticated user and selected shift' },
    401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'No session' },
  },
}), async (c) => c.json({ user: c.get('user'), shift: await getSessionShift(c.req.header('Authorization')!.slice(7)) }, 200));

authRouter.openapi(createRoute({
  method: 'patch', path: '/session', tags: ['Auth'],
  request: { body: { required: true, content: { 'application/json': { schema: ShiftBody } } } },
  responses: {
    200: { content: { 'application/json': { schema: SessionResponse } }, description: 'Shift selected for the current duty-doctor or nurse session' },
    401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'No session' },
    403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Shift selection is not available for this role' },
  },
}), async (c) => {
  const user = c.get('user');
  const { shift } = c.req.valid('json');
  const session = await selectSessionShift(c.req.header('Authorization')!.slice(7), user.id, shift);
  if (!session) return c.json({ error: 'shift selection is only for duty doctors and nurses' }, 403);
  return c.json({ user, shift: session.selected_shift }, 200);
});

authRouter.openapi(
  createRoute({
    method: 'delete', path: '/session', tags: ['Auth'],
    responses: {
      204: { description: 'Logged out' },
      401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'No session' },
    },
  }),
  async (c) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401);
    await deleteSession(header.slice(7));
    return c.body(null, 204);
  },
);
