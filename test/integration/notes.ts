import { actor, admission, assert, db, request } from './support';

export async function checkNotes() {
  const doctor = await actor();
  const incoming = await actor();
  const a = await admission(doctor);
  const created = await request(doctor, `/admissions/${a.id}/notes`, 'POST', {
    kind: 'progress',
    draft_body: 'Initial plan',
  });
  assert.equal(created.status, 201);
  const note = (await created.json()) as { id: string; revision: string | number };
  const initialRevision = Number(note.revision);
  const edit = { draft_body: 'Updated plan', expected_revision: initialRevision };
  assert.equal((await request(doctor, `/notes/${note.id}/draft`, 'PATCH', edit)).status, 200);
  assert.equal(
    (await request(doctor, `/admissions/${a.id}/notes/${note.id}`, 'PATCH', edit)).status,
    409,
  );
  assert.equal(
    (await request(doctor, `/notes/${note.id}/draft`, 'PATCH', { draft_body: 'Missing revision' }))
      .status,
    400,
  );
  const [stored] = await db`SELECT draft_body FROM clinical.notes WHERE id = ${note.id}`;
  assert.equal(stored.draft_body, 'Updated plan');
  const versions = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      request(doctor, `/notes/${note.id}/confirm`, 'POST', { body: `Version ${i}` }),
    ),
  );
  assert(
    versions.every((response) => response.status === 201),
    'all concurrent confirmations must succeed',
  );
  const numbers = await db<
    { version_no: number }[]
  >`SELECT version_no FROM clinical.note_versions WHERE note_id = ${note.id} ORDER BY version_no`;
  assert.deepEqual(
    numbers.map((v) => v.version_no),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  const legacyResponse = await request(doctor, '/handover-sessions', 'POST', {
    incoming_doctor_id: incoming.user.id,
  });
  assert.equal(legacyResponse.status, 201);
  const legacy = (await legacyResponse.json()) as { id: string };
  const response = await request(doctor, '/ipass', 'POST', {
    incoming_doctor_id: incoming.user.id,
  });
  assert.equal(response.status, 201);
  const handover = (await response.json()) as { session: { id: string }; items: { id: string }[] };
  const item = handover.items[0];
  const summary = {
    patient_summary: 'Updated plan',
    action_list: 'Continue plan',
    contingency: 'Call doctor if worse',
  };
  assert.equal((await request(doctor, `/ipass/items/${item.id}`, 'PATCH', summary)).status, 200);
  assert.equal((await request(doctor, `/ipass/items/${item.id}/sign`, 'POST')).status, 200);
  assert.equal((await request(doctor, `/ipass/${handover.session.id}/send`, 'POST')).status, 200);
  assert.equal(
    (
      await request(doctor, `/notes/${note.id}/draft`, 'PATCH', {
        draft_body: 'New important plan after signing',
        expected_revision: initialRevision + 1,
      })
    ).status,
    200,
  );
  const detail = (await (await request(doctor, `/handover-sessions/${legacy.id}`)).json()) as {
    items: { stale: boolean }[];
  };
  assert.equal(detail.items[0].stale, true);
  assert.equal(
    (await request(incoming, `/ipass/items/${item.id}/accept`, 'POST', {})).status,
    409,
    'edited notes must invalidate signed handovers',
  );
  assert.equal(
    (await request(doctor, `/ipass/items/${item.id}/refresh`, 'POST', summary)).status,
    200,
  );
  assert.equal((await request(incoming, `/ipass/items/${item.id}/accept`, 'POST', {})).status, 200);
}
