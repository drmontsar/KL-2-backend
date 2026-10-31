import { actor, admission, assert, db, request, withDatabaseFailure } from './support';
import { subscribeNotifications } from '../../src/services/notifications';

export async function checkAtomicity() {
  const doctor = await actor();
  const nurse = await actor('nurse');
  const a = await admission(doctor, nurse);
  let resolveDelivery!: (notification: unknown) => void;
  const delivered = new Promise<unknown>((resolve) => {
    resolveDelivery = resolve;
  });
  const unsubscribe = await subscribeNotifications(nurse.user.id, async (notification) => {
    resolveDelivery(notification);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let large: Response;
  try {
    large = await request(doctor, `/admissions/${a.id}/handoffs`, 'POST', {
      reason: 'x'.repeat(9000),
    });
    const event = (await Promise.race([
      delivered,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('notification not delivered')), 5000);
      }),
    ])) as { payload: { reason: string } };
    assert.equal(
      event.payload.reason.length,
      9000,
      'listeners must receive the full durable payload',
    );
  } finally {
    clearTimeout(timer);
    await unsubscribe();
  }
  assert.equal(large.status, 201, 'large durable payloads must not overflow PostgreSQL NOTIFY');
  const handoff = (await large.json()) as { id: string };
  const [notification] =
    await db`SELECT id FROM clinical.notifications WHERE payload->>'handoff_id' = ${handoff.id}`;
  assert(notification);
  await withDatabaseFailure('clinical.notifications', async () => {
    const failed = await request(doctor, `/admissions/${a.id}/handoffs`, 'POST', {
      reason: 'Must roll back',
    });
    assert.equal(failed.status, 500);
    const [count] =
      await db`SELECT count(*)::int AS n FROM clinical.handoffs WHERE admission_id = ${a.id} AND reason = 'Must roll back'`;
    assert.equal(count.n, 0);
  });
  const [before] = await db`SELECT revision, severity FROM clinical.admissions WHERE id = ${a.id}`;
  await withDatabaseFailure('clinical.audit_log', async () => {
    const failed = await request(doctor, `/admissions/${a.id}`, 'PATCH', {
      severity: 'unstable',
      expected_revision: Number(before.revision),
    });
    assert.equal(failed.status, 500);
    assert.match(failed.headers.get('X-Request-Id') ?? '', /^[0-9a-f-]{36}$/);
    const [after] = await db`SELECT revision, severity FROM clinical.admissions WHERE id = ${a.id}`;
    assert.equal(after.severity, before.severity);
    assert.equal(after.revision, before.revision);
  });
  assert.equal(
    (
      await request(doctor, `/admissions/${a.id}`, 'PATCH', {
        severity: 'watcher',
        expected_revision: Number(before.revision),
      })
    ).status,
    200,
  );
  const [audit] =
    await db`SELECT actor_user_id FROM clinical.audit_log WHERE record_id = ${a.id} AND action = 'update' ORDER BY id DESC LIMIT 1`;
  assert.equal(audit.actor_user_id, doctor.user.id);
  assert.equal(
    (await request(nurse, `/notifications/${notification.id}/read`, 'POST')).status,
    200,
  );
  const all = (await (await request(nurse, '/notifications?unread_only=false')).json()) as {
    id: string;
  }[];
  const unread = (await (await request(nurse, '/notifications?unread_only=true')).json()) as {
    id: string;
  }[];
  assert(all.some((n) => n.id === notification.id));
  assert(!unread.some((n) => n.id === notification.id));
  assert.equal((await request(nurse, '/notifications?unread_only=nonsense')).status, 400);
}
