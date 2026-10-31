import { actor, admission, assert, db, request } from './support';

export async function checkClinicalState() {
  const doctor = await actor();
  const nurse = await actor('nurse');
  const a = await admission(doctor, nurse);
  const taskResponse = await request(nurse, `/admissions/${a.id}/nursing-tasks`, 'POST', {
    description: 'Five-minute task',
    interval_minutes: 5,
    due_at: new Date(Date.now() - 60000).toISOString(),
  });
  assert.equal(taskResponse.status, 201);
  const task = (await taskResponse.json()) as { id: string; due_at: string };
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      request(nurse, `/nursing-tasks/${task.id}/complete`, 'POST', {
        expected_due_at: task.due_at,
      }),
    ),
  );
  assert.equal(responses.filter((r) => r.status === 200).length, 1);
  assert.equal(responses.filter((r) => r.status === 409).length, 3);
  const [count] =
    await db`SELECT count(*)::int AS n FROM clinical.nursing_task_completions WHERE task_id = ${task.id}`;
  assert.equal(count.n, 1);
  const [next] = await db<
    { due_at: Date }[]
  >`UPDATE clinical.nursing_recurring_tasks SET due_at = clock_timestamp() - interval '1 minute' WHERE id = ${task.id} RETURNING due_at`;
  assert.equal(
    (
      await request(nurse, `/nursing-tasks/${task.id}/complete`, 'POST', {
        expected_due_at: next.due_at.toISOString(),
      })
    ).status,
    200,
    'API millisecond precision must identify a database-generated occurrence',
  );
  const draft = await request(doctor, `/admissions/${a.id}/orders`, 'POST', {
    kind: 'medication',
    payload: { drug: 'Review drug', dose: '1 mg', route: 'oral' },
  });
  assert.equal(draft.status, 201);
  const order = (await draft.json()) as { id: string };
  await db`UPDATE clinical.admissions SET status = 'discharged', discharged_at = now(), exit_type = 'died' WHERE id = ${a.id}`;
  assert.equal(
    (
      await request(doctor, `/admissions/${a.id}/orders`, 'POST', {
        kind: 'medication',
        payload: { drug: 'Invalid after discharge' },
      })
    ).status,
    409,
  );
  assert.equal((await request(doctor, `/orders/${order.id}/confirm`, 'POST', {})).status, 409);
  const [tasks] =
    await db`SELECT count(*)::int AS n FROM clinical.tasks WHERE order_id = ${order.id}`;
  assert.equal(tasks.n, 0);
  assert.equal(
    (
      await request(nurse, `/nursing-tasks/${task.id}/complete`, 'POST', {
        expected_due_at: next.due_at.toISOString(),
      })
    ).status,
    409,
  );
}
