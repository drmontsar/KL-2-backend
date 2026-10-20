import type { Context, Next } from 'hono';
import { resolveSession } from '../db/queries/auth';

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const user = await resolveSession(header.slice(7));
  if (!user) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('user', user);
  await next();
}
