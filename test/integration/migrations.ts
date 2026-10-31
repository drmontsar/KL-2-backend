import { readFile } from 'node:fs/promises';
import { createNote } from '../../src/db/queries/notes';
import { actor, admission, assert, db } from './support';

assert.equal(process.env.DISPOSABLE_DATABASE, '1');
assert.equal(process.env.NODE_ENV, 'test');
const migration = await readFile('migrations/051_clinical_revisions.sql', 'utf8');
const [up, down] = migration.split('-- down');
let rolledBack = false;
try {
  const doctor = await actor();
  const a = await admission(doctor);
  await db.begin((tx) => tx.unsafe(down));
  rolledBack = true;
  const [before] = await db`SELECT revision FROM clinical.admissions WHERE id = ${a.id}`;
  const note = await createNote({
    admission_id: a.id,
    kind: 'progress',
    draft_body: 'Rollback preserves content',
    created_by: doctor.user.id,
  });
  const [withoutTrigger] = await db`SELECT revision FROM clinical.admissions WHERE id = ${a.id}`;
  assert.equal(withoutTrigger.revision, before.revision);
  await db.begin((tx) => tx.unsafe(up));
  rolledBack = false;
  const [afterUp] = await db`SELECT revision FROM clinical.admissions WHERE id = ${a.id}`;
  assert.equal(
    Number(afterUp.revision),
    Number(before.revision) + 1,
    'up must invalidate old handover snapshots',
  );
  await db`UPDATE clinical.notes SET draft_body = 'Updated after reapplying migration' WHERE id = ${note.id}`;
  const [afterEdit] = await db`SELECT revision FROM clinical.admissions WHERE id = ${a.id}`;
  assert.equal(Number(afterEdit.revision), Number(afterUp.revision) + 1);
  const [stored] = await db`SELECT draft_body FROM clinical.notes WHERE id = ${note.id}`;
  assert.equal(stored.draft_body, 'Updated after reapplying migration');
  console.log('Clinical revision migration down/up preserves data and restores tracking');
} finally {
  if (rolledBack) await db.begin((tx) => tx.unsafe(up));
  await db.end();
}
