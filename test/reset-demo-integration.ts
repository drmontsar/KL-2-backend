import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

assert.equal(process.env.DISPOSABLE_DATABASE, '1');
assert.equal(process.env.NODE_ENV, 'test');
assert(process.env.DATABASE_URL);
const sql = postgres(process.env.DATABASE_URL);
const manifest = JSON.parse(await readFile('test-data/manifest.json', 'utf8')) as {
  files: string[];
  dataset_id: string;
};
const groups = (
  await Promise.all(
    manifest.files.map(
      async (file) =>
        JSON.parse(await readFile(`test-data/${file}`, 'utf8')) as {
          table: string;
          rows: unknown[];
        }[],
    ),
  )
).flat();
const schemas = [...new Set([...groups.map((group) => group.table.split('.')[0]), 'test_data'])];
const expected = new Map<string, number>();
for (const group of groups)
  expected.set(group.table, (expected.get(group.table) ?? 0) + group.rows.length);
expected.set(
  'test_data.seed_records',
  groups.reduce((sum, group) => sum + group.rows.length, 0),
);
expected.set('test_data.datasets', 1);

async function applicationSnapshot() {
  const tables = await sql<
    { schemaname: string; tablename: string }[]
  >`SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ${sql(schemas)} ORDER BY schemaname, tablename`;
  const snapshot: Record<string, { count: number; digest: string }> = {};
  for (const table of tables) {
    const [row] = await sql.unsafe(
      `SELECT count(*)::int AS count, md5(COALESCE(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text), '')) AS digest FROM "${table.schemaname}"."${table.tablename}" t`,
    );
    snapshot[`${table.schemaname}.${table.tablename}`] = row as { count: number; digest: string };
  }
  return snapshot;
}

function run(command: 'seed' | 'reset:demo', success = true) {
  const result = spawnSync(process.execPath, ['run', command], {
    env: process.env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (success) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0, 'reset should fail without changing existing data');
}

async function assertCanonicalData() {
  const snapshot = await applicationSnapshot();
  for (const [table, state] of Object.entries(snapshot))
    assert.equal(state.count, expected.get(table) ?? 0, `unexpected records in ${table}`);
  const [bruce] =
    await sql`SELECT id, name, role, job_role, disabled_at FROM staff.users WHERE phone = '1112223330'`;
  assert.equal(bruce.name, 'Bruce Wayne');
  assert.equal(bruce.role, 'doctor');
  assert.equal(bruce.job_role, 'duty_doctor');
  assert.equal(bruce.disabled_at, null);
  const [shift] =
    await sql`SELECT count(*)::int AS n FROM staff.shifts s JOIN staff.shift_units su ON su.shift_id = s.id JOIN staff.unit_memberships m ON m.user_id = s.user_id AND m.unit_id = su.unit_id WHERE s.user_id = ${bruce.id} AND s.status = 'active' AND now() BETWEEN s.starts_at AND s.ends_at`;
  assert.equal(shift.n, 1, 'Bruce must have a currently active, scoped shift');
  const [missingCoverage] =
    await sql`SELECT count(*)::int AS n FROM clinical.admissions a WHERE a.status = 'active' AND NOT EXISTS (SELECT 1 FROM clinical.staff_assignments sa WHERE sa.admission_id = a.id AND sa.user_id = ${bruce.id} AND sa.ends_at IS NULL)`;
  assert.equal(missingCoverage.n, 0);
  const [stale] =
    await sql`SELECT count(*)::int AS n FROM clinical.ipass_items i JOIN clinical.admissions a ON a.id = i.admission_id WHERE i.snapshot_revision <> a.revision`;
  assert.equal(stale.n, 0, 'I-PASS snapshots must reflect the actual clinical revisions');
  const [nursing] = await sql`SELECT snapshot FROM clinical.nurse_handover_items LIMIT 1`;
  assert.equal(nursing.snapshot.medications.length, 1);
  assert.equal(nursing.snapshot.open_orders.length, 1);
  assert.equal(
    nursing.snapshot.infusions.length,
    1,
    'fresh nursing snapshots must contain the running infusion',
  );
  const [futureEvents] =
    await sql`SELECT count(*)::int AS n FROM opd.visits WHERE signed_at > clock_timestamp()`;
  assert.equal(futureEvents.n, 0);
  const [invalidMovements] =
    await sql`SELECT count(*)::int AS n FROM clinical.patient_movements m JOIN clinical.admissions a ON a.id = m.admission_id WHERE m.requested_at > m.departed_at OR a.admitted_at > m.departed_at OR m.departed_at > m.completed_at`;
  assert.equal(invalidMovements.n, 0);
  return snapshot;
}

try {
  await sql`CREATE TABLE clinical.reset_old_data_probe (id integer PRIMARY KEY)`;
  await sql`INSERT INTO clinical.reset_old_data_probe VALUES (1)`;
  await sql`CREATE TABLE public.reset_preserved_probe (id integer PRIMARY KEY)`;
  await sql`INSERT INTO public.reset_preserved_probe VALUES (1)`;
  await sql`UPDATE staff.users SET name = 'Old Bruce', disabled_at = now() WHERE phone = '1112223330'`;
  const migrations = await sql`SELECT * FROM _migrations ORDER BY id`;
  const before = await applicationSnapshot();
  // Fail after TRUNCATE and several fixture inserts, not just during preflight validation.
  await sql.unsafe(`CREATE FUNCTION public.reset_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected fixture failure'; END $$;
    CREATE TRIGGER reset_fixture_failure BEFORE INSERT ON clinical.patients FOR EACH ROW EXECUTE FUNCTION public.reset_fixture_failure()`);
  try {
    run('reset:demo', false);
  } finally {
    await sql.unsafe(
      'DROP TRIGGER reset_fixture_failure ON clinical.patients; DROP FUNCTION public.reset_fixture_failure()',
    );
  }
  assert.deepEqual(
    await applicationSnapshot(),
    before,
    'a failed reset must restore every application table',
  );
  // An external dependency must fail safely rather than being deleted with CASCADE.
  await sql`CREATE TABLE public.reset_external_reference (patient_id uuid REFERENCES clinical.patients(id))`;
  try {
    run('reset:demo', false);
    assert.deepEqual(await applicationSnapshot(), before);
  } finally {
    await sql`DROP TABLE public.reset_external_reference`;
  }
  const started = Date.now();
  run('reset:demo');
  const canonical = await assertCanonicalData();
  const [clock] = await sql<
    { snapshot_at: Date }[]
  >`SELECT snapshot_at FROM test_data.datasets WHERE dataset_id = ${manifest.dataset_id}`;
  assert(
    clock.snapshot_at.getTime() >= started - 5000 &&
      clock.snapshot_at.getTime() <= Date.now() + 5000,
    'reset must refresh the fixture clock',
  );
  run('seed');
  assert.deepEqual(
    await applicationSnapshot(),
    canonical,
    'non-destructive seeding after reset must preserve the refreshed timestamps',
  );
  await sql`UPDATE staff.users SET name = 'Changed Bruce', disabled_at = now() WHERE phone = '1112223330'`;
  run('reset:demo');
  await assertCanonicalData();
  assert.deepEqual(await sql`SELECT * FROM _migrations ORDER BY id`, migrations);
  const [preserved] = await sql`SELECT count(*)::int AS n FROM public.reset_preserved_probe`;
  assert.equal(preserved.n, 1);
  console.log(
    'Demo reset rollback, clean schema data, refreshed dates, Bruce Wayne, and repeatability checks passed',
  );
} finally {
  await sql`DROP TABLE IF EXISTS clinical.reset_old_data_probe`;
  await sql`DROP TABLE IF EXISTS public.reset_preserved_probe`;
  await sql.end();
}
