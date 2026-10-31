import type { Context, Next } from 'hono';
import { resolveSession } from '../db/queries/auth';
import { touchLastSeen } from '../db/queries/users';

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
  touchLastSeen(user.id);
  await next();
}
