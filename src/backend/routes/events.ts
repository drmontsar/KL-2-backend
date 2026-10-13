import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db/index';
import { notifChannel } from '../db/queries/notifications';

export const eventsRouter = new Hono();

eventsRouter.get('/', async (c) => {
  const userId = c.req.query('user_id');
  if (!userId) {
    return c.text('user_id required', 400);
  }

  const channel = notifChannel(userId);

  return streamSSE(c, async (stream) => {
    // ponytail: single pg connection per SSE client; add connection pooling if fan-out becomes an issue
    const { unlisten } = await db.listen(channel, (payload) => {
      stream.writeSSE({ data: payload }).catch(() => {});
    });

    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => {
        clearInterval(heartbeat);
      });
    }, 25_000);

    await new Promise<void>((resolve) => stream.onAbort(resolve));

    clearInterval(heartbeat);
    await unlisten();
  });
});
