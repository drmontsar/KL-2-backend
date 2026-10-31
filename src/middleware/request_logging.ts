import type { ErrorHandler, MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { User } from '../db/queries/users';
import { DomainError } from '../errors';
import { errorDiagnostics, logger } from '../logger';

type Env = { Variables: { user: User; requestId: string } };

export const requestLogging: MiddlewareHandler<Env> = async (c, next) => {
  const start = Date.now();
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);
  try {
    await next();
  } finally {
    logger.info(
      {
        requestId,
        method: c.req.method,
        route: routePath(c, -1),
        status: c.res.status,
        durationMs: Date.now() - start,
      },
      'request completed',
    );
  }
};

export const handleError: ErrorHandler<Env> = (error, c) => {
  if (error instanceof DomainError) return c.json({ error: error.code }, 409);
  logger.error(
    {
      requestId: c.get('requestId'),
      method: c.req.method,
      route: routePath(c, -1),
      ...errorDiagnostics(error),
    },
    'request failed',
  );
  return c.text('Internal Server Error', 500);
};
