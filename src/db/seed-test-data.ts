import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { calculateNews2 } from '../clinical/news2';
import { buildNursingCarePlan } from '../clinical/nursing';
import { AssessmentBody } from '../contracts/nursing';
import { config } from '../config';
import { hashPassword } from '../security/password';
import { demoEmail } from './demo_email';
import { db } from './index';
import { getNursingHandoverSnapshot } from './queries/nurse_handover';

type Json = Parameters<(typeof db)['json']>[0];
type TableDefinition = {
  keys: readonly string[];
  json?: readonly string[];
  identity?: readonly string[];
};
const tables: Record<string, TableDefinition> = {
  'organization.facilities': { keys: ['id'], identity: ['code'] },
  'organization.departments': { keys: ['id'], identity: ['facility_id', 'code'] },
  'organization.units': { keys: ['id'], identity: ['department_id', 'code'] },
  'organization.wards': { keys: ['id'], identity: ['unit_id', 'name'] },
  'organization.rooms': { keys: ['id'], identity: ['ward_id', 'name'] },
  'organization.beds': { keys: ['id'], identity: ['room_id', 'label'] },
  'staff.users': { keys: ['id'], identity: ['role', 'job_role'] },
  'staff.unit_memberships': { keys: ['user_id', 'unit_id'] },
  'staff.shifts': { keys: ['id'], identity: ['user_id', 'starts_at', 'ends_at'] },
  'staff.shift_units': { keys: ['shift_id', 'unit_id'] },
  'clinical.medication_catalog': { keys: ['id'], identity: ['code'] },
  'clinical.medication_catalog_allergens': { keys: ['medication_id', 'allergen'] },
  'opd.diagnosis_catalog': { keys: ['code'] },
  'opd.investigation_catalog': { keys: ['code'] },
  'forms.templates': { keys: ['id'], identity: ['category'] },
  'forms.template_versions': {
    keys: ['id'],
    identity: ['template_id', 'version'],
    json: ['fields'],
  },
  'clinical.patients': { keys: ['id'], identity: ['uhid'], json: ['allergies'] },
  'clinical.patient_identifiers': { keys: ['id'], identity: ['patient_id', 'type', 'value'] },
  'clinical.patient_contacts': { keys: ['id'], identity: ['patient_id', 'type'] },
  'clinical.next_of_kin': { keys: ['id'], identity: ['patient_id'] },
  'clinical.patient_coverage': { keys: ['id'], identity: ['patient_id', 'policy_number'] },
  'clinical.admissions': { keys: ['id'], identity: ['patient_id'] },
  'clinical.bed_assignments': { keys: ['id'], identity: ['admission_id', 'bed_id'] },
  'clinical.staff_assignments': {
    keys: ['id'],
    identity: ['admission_id', 'user_id', 'assignment_type'],
  },
  'clinical.diagnoses': { keys: ['id'], identity: ['patient_id', 'admission_id'] },
  'clinical.vitals': { keys: ['id'], identity: ['admission_id'], json: ['news2_component_scores'] },
  'clinical.observation_schedules': { keys: ['admission_id'] },
  'clinical.alerts': { keys: ['id'], identity: ['admission_id', 'type'] },
  'clinical.notes': { keys: ['id'], identity: ['admission_id'] },
  'clinical.note_versions': { keys: ['id'], identity: ['note_id', 'version_no'] },
  'clinical.consultant_rounds': {
    keys: ['id'],
    identity: ['admission_id', 'consultant_id', 'note_id'],
  },
  'clinical.orders': { keys: ['id'], identity: ['admission_id', 'kind'], json: ['payload'] },
  'clinical.tasks': { keys: ['id'], identity: ['order_id', 'admission_id'] },
  'clinical.medication_schedules': { keys: ['id'], identity: ['admission_id', 'order_id'] },
  'clinical.medication_allergy_reviews': { keys: ['id'], identity: ['schedule_id'] },
  'clinical.medication_doses': { keys: ['id'], identity: ['schedule_id', 'due_at'] },
  'clinical.infusion_events': { keys: ['id'], identity: ['schedule_id'] },
  'clinical.nursing_assessments': {
    keys: ['id'],
    identity: ['admission_id'],
    json: ['vulnerabilities', 'devices', 'morse', 'braden', 'must', 'care_plan'],
  },
  'clinical.nursing_care_plan_items': { keys: ['id'], identity: ['admission_id'] },
  'clinical.nursing_recurring_tasks': { keys: ['id'], identity: ['admission_id'] },
  'clinical.patient_weights': { keys: ['id'], identity: ['admission_id'] },
  'clinical.fluid_entries': { keys: ['id'], identity: ['admission_id', 'direction'] },
  'clinical.nursing_sbar_calls': {
    keys: ['id'],
    identity: ['admission_id', 'called_by', 'doctor_id'],
  },
  'clinical.cross_referrals': { keys: ['id'], identity: ['admission_id', 'consultant_id'] },
  'clinical.patient_movements': {
    keys: ['id'],
    identity: ['admission_id', 'movement_type'],
    json: ['equipment'],
  },
  'finance.claims': { keys: ['id'], identity: ['admission_id', 'coverage_id'] },
  'finance.claim_queries': { keys: ['id'], identity: ['claim_id'] },
  'finance.claim_events': { keys: ['id'], identity: ['claim_id'] },
  'finance.deposits': { keys: ['id'], identity: ['admission_id', 'reference'] },
  'clinical.discharge_plans': { keys: ['id'], identity: ['admission_id'] },
  'clinical.discharge_tasks': { keys: ['id'], identity: ['plan_id', 'code'] },
  'opd.visits': {
    keys: ['id'],
    identity: ['patient_id', 'token'],
    json: ['chief_complaints', 'triage'],
  },
  'opd.visit_diagnoses': { keys: ['id'], identity: ['visit_id', 'code'] },
  'opd.visit_investigations': { keys: ['id'], identity: ['visit_id', 'code'] },
  'opd.prescriptions': { keys: ['id'], identity: ['visit_id', 'medication_id'] },
  'opd.visit_charges': { keys: ['visit_id'] },
  'opd.dispatches': { keys: ['id'], identity: ['visit_id', 'kind'] },
  'clinical.admission_requests': {
    keys: ['id'],
    identity: ['patient_id', 'source', 'opd_visit_id'],
  },
  'forms.instances': { keys: ['id'], identity: ['patient_id', 'template_id'] },
  'forms.instance_versions': {
    keys: ['id'],
    identity: ['instance_id', 'template_version_id', 'version'],
    json: ['fields', 'form_values', 'source_snapshot'],
  },
  'clinical.ipass_sessions': {
    keys: ['id'],
    identity: ['outgoing_doctor_id', 'incoming_doctor_id'],
  },
  'clinical.ipass_items': { keys: ['id'], identity: ['session_id', 'admission_id'] },
  'clinical.nurse_handover_sessions': {
    keys: ['id'],
    identity: ['outgoing_nurse_id', 'incoming_nurse_id'],
  },
  'clinical.nurse_handover_items': {
    keys: ['id'],
    identity: ['session_id', 'admission_id'],
    json: ['snapshot', 'checklist'],
  },
};
const Manifest = z.object({
  dataset_id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  snapshot_at: z.string().datetime({ offset: true }),
  files: z.array(z.string().regex(/^[a-z0-9-]+\.json$/)).min(1),
});
const timestampDefaults: Record<string, readonly string[]> = {
  'organization.facilities': ['created_at'],
  'organization.departments': ['created_at'],
  'organization.units': ['created_at'],
  'organization.wards': ['created_at'],
  'organization.rooms': ['created_at'],
  'organization.beds': ['created_at'],
  'staff.users': ['created_at'],
  'staff.unit_memberships': ['created_at'],
  'staff.shifts': ['created_at'],
  'forms.templates': ['created_at'],
  'forms.template_versions': ['created_at'],
  'clinical.patients': ['created_at'],
  'clinical.patient_identifiers': ['created_at'],
  'clinical.patient_contacts': ['created_at'],
  'clinical.next_of_kin': ['created_at'],
  'clinical.patient_coverage': ['created_at'],
  'clinical.admissions': ['admitted_at'],
  'clinical.bed_assignments': ['starts_at'],
  'clinical.staff_assignments': ['starts_at'],
  'clinical.diagnoses': ['created_at'],
  'clinical.vitals': ['recorded_at'],
  'clinical.observation_schedules': ['updated_at'],
  'clinical.alerts': ['created_at'],
  'clinical.notes': ['created_at'],
  'clinical.note_versions': ['confirmed_at'],
  'clinical.orders': ['created_at'],
  'clinical.medication_schedules': ['created_at'],
  'clinical.medication_allergy_reviews': ['reviewed_at'],
  'clinical.nursing_assessments': ['assessed_at'],
  'clinical.nursing_care_plan_items': ['created_at'],
  'clinical.nursing_recurring_tasks': ['created_at'],
  'clinical.patient_weights': ['recorded_at'],
  'clinical.fluid_entries': ['recorded_at'],
  'clinical.nursing_sbar_calls': ['created_at'],
  'clinical.cross_referrals': ['created_at'],
  'clinical.patient_movements': ['requested_at'],
  'finance.claims': ['created_at', 'updated_at'],
  'finance.claim_queries': ['raised_at'],
  'finance.claim_events': ['created_at'],
  'finance.deposits': ['created_at'],
  'clinical.discharge_plans': ['requested_at'],
  'opd.visits': ['created_at'],
  'opd.prescriptions': ['created_at'],
  'opd.visit_charges': ['calculated_at'],
  'opd.dispatches': ['created_at'],
  'clinical.admission_requests': ['requested_at'],
  'forms.instances': ['created_at'],
  'forms.instance_versions': ['created_at'],
  'clinical.ipass_sessions': ['created_at'],
  'clinical.nurse_handover_sessions': ['created_at'],
};
const File = z.array(
  z.object({ table: z.string(), rows: z.array(z.record(z.string(), z.unknown())).min(1) }),
);
const Observation = z.object({
  resp_rate: z.number().int().positive(),
  spo2: z.number().min(0).max(100),
  on_supplemental_oxygen: z.boolean(),
  temperature: z.number(),
  bp_systolic: z.number().int().positive(),
  heart_rate: z.number().int().positive(),
  consciousness: z.enum(['alert', 'confusion', 'voice', 'pain', 'unresponsive']),
  news2_score: z.number().int(),
  news2_escalation: z.enum(['low', 'low-medium', 'medium', 'high']),
  news2_component_scores: z.record(z.string(), z.number()),
});
const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid fixture column: ${name}`);
  return `"${name}"`;
};

async function main() {
  const reset = process.argv[2] === '--reset';
  if (process.argv.length !== (reset ? 3 : 2))
    throw new Error('Usage: bun run seed or bun run reset:demo');
  const url = new URL(config.databaseUrl);
  if (
    !['development', 'test'].includes(config.nodeEnv) ||
    !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) ||
    url.pathname !== '/klinik'
  ) {
    throw new Error('Refusing to seed: use the local non-production KL-2 database named klinik');
  }
  const directory = resolve('test-data');
  const manifest = Manifest.parse(
    JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
  );
  const groups = (
    await Promise.all(
      manifest.files.map(async (file) =>
        File.parse(JSON.parse(await readFile(resolve(directory, file), 'utf8'))),
      ),
    )
  ).flat();
  const bruce = groups
    .find((group) => group.table === 'staff.users')
    ?.rows.find((row) => row.phone === '1112223330');
  if (
    !bruce ||
    bruce.name !== 'Bruce Wayne' ||
    bruce.role !== 'doctor' ||
    bruce.job_role !== 'duty_doctor' ||
    bruce.disabled_at
  ) {
    throw new Error('Fixtures must include enabled duty doctor Bruce Wayne, phone 1112223330');
  }
  const seen = new Set<string>();
  for (const group of groups) {
    const table = tables[group.table];
    if (!table) throw new Error(`Unsupported fixture table: ${group.table}`);
    for (const row of group.rows) {
      for (const column of Object.keys(row)) identifier(column);
      if (table.keys.some((key) => row[key] === undefined || row[key] === null))
        throw new Error(`Missing key for ${group.table}`);
      const key = `${group.table}:${JSON.stringify(table.keys.map((column) => row[column]))}`;
      if (seen.has(key)) throw new Error(`Duplicate fixture key: ${key}`);
      seen.add(key);
      if (group.table === 'clinical.nursing_assessments') {
        const scores = buildNursingCarePlan(AssessmentBody.parse(row));
        if (
          row.morse_score !== scores.morse ||
          row.braden_score !== scores.braden ||
          row.must_score !== scores.must ||
          JSON.stringify(row.care_plan) !== JSON.stringify(scores.care_plan)
        )
          throw new Error('Nursing fixture does not match scoring rules');
      }
      if (group.table === 'clinical.vitals') {
        const observation = Observation.parse(row);
        const actual = calculateNews2(observation);
        if (
          actual.score !== observation.news2_score ||
          actual.escalation !== observation.news2_escalation ||
          Object.entries(actual.component_scores).some(
            ([name, value]) => observation.news2_component_scores[name] !== value,
          )
        ) {
          throw new Error(`NEWS2 fixture does not match scoring rules: ${String(row.id)}`);
        }
      }
    }
  }
  let connected = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const [target] = await db<
        { database: string; user_name: string }[]
      >`SELECT current_database() AS database, current_user AS user_name`;
      if (target.database !== 'klinik' || target.user_name !== 'klinik')
        throw new Error('Refusing to seed an unexpected database or database user');
      connected = true;
      break;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (
        !['ECONNREFUSED', 'ECONNRESET', '57P03', 'CONNECTION_CLOSED'].includes(code ?? '') ||
        attempt === 29
      )
        throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  }
  if (!connected) throw new Error('Local test database is not ready');
  const migrate = spawnSync(process.execPath, ['run', 'src/db/migrate.ts'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (migrate.error || migrate.status !== 0)
    throw new Error('Migration failed; no test data was inserted');

  if (reset)
    console.warn(
      'Resetting all application data in the local klinik database, including login sessions.',
    );
  const counts = await db.begin(async (tx) => {
    const [target] = await tx<
      { database: string; user_name: string }[]
    >`SELECT current_database() AS database, current_user AS user_name`;
    if (target.database !== 'klinik' || target.user_name !== 'klinik')
      throw new Error('Refusing to seed an unexpected database or database user');
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('klinik:test-data', 0))`;
    const schemas = [
      ...new Set([...Object.keys(tables).map((table) => table.split('.')[0]), 'test_data']),
    ];
    if (reset) {
      const existing = await tx<{ schemaname: string; tablename: string }[]>`
        SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ${tx(schemas)} ORDER BY schemaname, tablename
      `;
      // No CASCADE: an external schema referencing application data must stop the reset.
      await tx.unsafe(
        `TRUNCATE TABLE ${existing.map((table) => `${identifier(table.schemaname)}.${identifier(table.tablename)}`).join(', ')} RESTART IDENTITY`,
      );
    }
    await tx`INSERT INTO test_data.datasets (dataset_id, snapshot_at) VALUES (${manifest.dataset_id}, ${reset ? new Date().toISOString() : manifest.snapshot_at}) ON CONFLICT DO NOTHING`;
    const [dataset] = await tx<
      { snapshot_at: Date }[]
    >`SELECT snapshot_at FROM test_data.datasets WHERE dataset_id = ${manifest.dataset_id}`;
    const offset = dataset.snapshot_at.getTime() - new Date(manifest.snapshot_at).getTime();
    const catalogColumns = await tx<
      { table_schema: string; table_name: string; column_name: string; data_type: string }[]
    >`
      SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns WHERE table_schema IN ${tx(schemas)}
    `;
    let inserted = 0;
    let preserved = 0;
    for (const group of groups) {
      const definition = tables[group.table];
      const [schema, table] = group.table.split('.');
      const tableName = `${identifier(schema)}.${identifier(table)}`;
      const timestampColumns = catalogColumns.filter(
        (column) =>
          column.table_schema === schema &&
          column.table_name === table &&
          column.data_type.startsWith('timestamp'),
      );
      for (const fixture of group.rows) {
        const row = { ...fixture };
        for (const column of timestampDefaults[group.table] ?? []) {
          if (row[column] === undefined) row[column] = manifest.snapshot_at;
        }
        for (const column of timestampColumns) {
          if (typeof row[column.column_name] === 'string') {
            row[column.column_name] = new Date(
              new Date(row[column.column_name] as string).getTime() + offset,
            ).toISOString();
          }
        }
        const keyValues = definition.keys.map((key) => row[key] as string | number | boolean);
        const recordKey = JSON.stringify(keyValues);
        const [owned] = await tx<{ record_key: string }[]>`
          SELECT record_key FROM test_data.seed_records
          WHERE dataset_id = ${manifest.dataset_id} AND table_name = ${group.table} AND record_key = ${recordKey}
        `;
        const where = definition.keys
          .map((key, index) => `${identifier(key)} = $${index + 1}`)
          .join(' AND ');
        const identity = definition.identity ?? [];
        const fields = identity.length ? identity.map(identifier).join(', ') : '1 AS present';
        const existing = await tx.unsafe(
          `SELECT ${fields} FROM ${tableName} WHERE ${where} LIMIT 1`,
          keyValues,
        );
        if (existing.length) {
          if (!owned)
            throw new Error(
              `Fixture key already belongs to an untracked record: ${group.table} ${recordKey}`,
            );
          if (
            identity.some((field) => {
              const actual = existing[0][field];
              const expected = row[field];
              return actual instanceof Date && typeof expected === 'string'
                ? actual.toISOString() !== new Date(expected).toISOString()
                : String(actual) !== String(expected);
            })
          )
            throw new Error(
              `Fixture identity changed; refusing to attach data: ${group.table} ${recordKey}`,
            );
          preserved++;
          continue;
        }
        if (group.table === 'clinical.ipass_items') {
          const [admission] = await tx<
            { revision: number }[]
          >`SELECT revision FROM clinical.admissions WHERE id = ${row.admission_id as string}`;
          if (!admission) throw new Error('Missing admission for I-PASS fixture');
          row.snapshot_revision = admission.revision;
        }
        if (group.table === 'clinical.nurse_handover_items')
          row.snapshot = await getNursingHandoverSnapshot(tx, row.admission_id as string);
        const columns = Object.keys(row);
        const values = columns.map((column) =>
          definition.json?.includes(column) && row[column] !== null
            ? tx.json(row[column] as Json)
            : row[column],
        );
        const names = columns.map(identifier).join(', ');
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const insertedRows = await tx.unsafe(
          `INSERT INTO ${tableName} (${names}) VALUES (${placeholders}) RETURNING 1 AS inserted`,
          values as NonNullable<Parameters<typeof tx.unsafe>[1]>,
        );
        if (!insertedRows.length)
          throw new Error(`Could not insert fixture: ${group.table} ${recordKey}`);
        await tx`
          INSERT INTO test_data.seed_records (dataset_id, table_name, record_key)
          VALUES (${manifest.dataset_id}, ${group.table}, ${recordKey}) ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
    }
    // Public demo credentials are generated only for local/test seed data.
    const demoHash = await hashPassword('password');
    for (const row of groups.find((group) => group.table === 'staff.users')?.rows ?? []) {
      const email = demoEmail(String(row.name));
      await tx`
        INSERT INTO staff.user_credentials (user_id, email, password_hash)
        VALUES (${String(row.id)}, ${email}, ${demoHash})
        ON CONFLICT (user_id) DO NOTHING
      `;
    }
    return { inserted, preserved };
  });
  console.log(
    `${reset ? 'Reset' : 'Seeded'} test dataset ${manifest.dataset_id}: inserted ${counts.inserted} records, preserved ${counts.preserved} existing records.`,
  );
}

try {
  await main();
} finally {
  await db.end();
}
