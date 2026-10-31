import { Hono } from 'hono';
import { getBunServer } from 'hono/bun';
import { streamSSE } from 'hono/streaming';
import type { User } from '../db/queries/users';
import { subscribeNotifications } from '../services/notifications';

type Variables = { user: User };
export const eventsRouter = new Hono<{ Variables: Variables }>();

eventsRouter.get('/', (c) => {
  // SSE owns its heartbeat; keep Bun's normal idle limit for other requests.
  getBunServer<{ timeout(request: Request, seconds: number): void }>(c)?.timeout(c.req.raw, 0);
  return streamSSE(c, async (stream) => {
    let aborted = false;
    const done = new Promise<void>((resolve) =>
      stream.onAbort(() => {
        aborted = true;
        resolve();
      }),
    );
    const unsubscribe = await subscribeNotifications(c.get('user').id, (notification) =>
      stream.writeSSE({ data: JSON.stringify(notification) }),
    );
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (aborted) return;
      heartbeat = setInterval(() => {
        void stream
          .writeSSE({ event: 'ping', data: String(Date.now()) })
          .catch(() => stream.abort());
      }, 25_000);
      await done;
    } finally {
      clearInterval(heartbeat);
      await unsubscribe();
    }
  });
});
