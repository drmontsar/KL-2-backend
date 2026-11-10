import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { notifChannel } from '../src/db/queries/notifications';
import { emailForFixturePhone } from './demo_login';

assert.equal(process.env.DISPOSABLE_DATABASE, '1');
assert.equal(process.env.NODE_ENV, 'test');
assert(process.env.BASE_URL);
assert(process.env.DATABASE_URL);
const base = process.env.BASE_URL;
const sql = postgres(process.env.DATABASE_URL);
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 45_000);
let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

async function request(path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: controller.signal,
  });
  assert(response.ok, `${path}: HTTP ${response.status} ${await response.clone().text()}`);
  return response;
}

try {
  assert.equal((await fetch(`${base}/events`)).status, 401);
  const groups = JSON.parse(await readFile('test-data/staff.json', 'utf8')) as {
    table: string;
    rows: { id: string; phone: string; job_role: string }[];
  }[];
  const nurseFixture = groups
    .find((group) => group.table === 'staff.users')!
    .rows.find((user) => user.job_role === 'staff_nurse')!;
  const doctor = (await (
    await request('/auth/login', undefined, { email: emailForFixturePhone('1112223330'), password: 'password' })
  ).json()) as { token: string };
  const nurse = (await (
    await request('/auth/login', undefined, { email: emailForFixturePhone(nurseFixture.phone), password: 'password' })
  ).json()) as { token: string; user: { id: string } };
  const admissions = (await (await request('/admissions?scope=mine', doctor.token)).json()) as {
    id: string;
    assigned_to: string;
  }[];
  const admission = admissions.find((row) => row.assigned_to === nurse.user.id);
  assert(admission, 'fixture must provide a nurse-assigned admission');

  async function listeners() {
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND query ILIKE 'listen %' AND position(${notifChannel(nurse.user.id)} in query) > 0`;
    return row.count;
  }
  const before = await listeners();
  const started = Date.now();
  const response = await fetch(`${base}/events`, {
    headers: { Authorization: `Bearer ${nurse.token}` },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert(response.headers.get('content-type')?.includes('text/event-stream'));
  reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  async function nextEvent() {
    while (true) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return {
          event: frame
            .split('\n')
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim(),
          data: frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n'),
        };
      }
      const chunk = await reader!.read();
      assert(!chunk.done, 'SSE closed before its heartbeat or notification');
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }

  // Do not shorten the real heartbeat: this must fail with Bun's default 10s timeout.
  assert.equal((await nextEvent()).event, 'ping');
  assert(Date.now() - started >= 20_000, 'stream must survive beyond the original idle timeout');
  assert.equal((await request('/ready', doctor.token)).status, 200);
  assert.equal(await listeners(), before + 1);
  const reason = 'SSE regression ' + 'x'.repeat(9000);
  const handoff = (await (
    await request(`/admissions/${admission.id}/handoffs`, doctor.token, { reason })
  ).json()) as { id: string };
  let notification: { type: string; payload: { handoff_id: string; reason: string } };
  do {
    notification = JSON.parse((await nextEvent()).data);
  } while (notification.type !== 'handoff.created');
  assert.equal(notification.payload.handoff_id, handoff.id);
  assert.equal(notification.payload.reason, reason);

  controller.abort();
  await reader.cancel().catch(() => {});
  const cleanupDeadline = Date.now() + 5000;
  while ((await listeners()) > before && Date.now() < cleanupDeadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await listeners(), before, 'disconnect must release the PostgreSQL listener');
  console.log('Live SSE idle survival, heartbeat, 9KB notification, and disconnect cleanup passed');
} finally {
  clearTimeout(deadline);
  controller.abort();
  await reader?.cancel().catch(() => {});
  await sql.end();
}
