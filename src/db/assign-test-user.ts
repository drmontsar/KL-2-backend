import { config } from '../config';
import { db } from './index';

async function main() {
  const phone = process.argv[2];
  if (!phone || process.argv.length !== 3) throw new Error('Usage: bun run assign:test-user -- <phone>');
  const url = new URL(config.databaseUrl);
  if (config.nodeEnv === 'production' || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) || url.pathname !== '/klinik') {
    throw new Error('Refusing to assign test data outside the local non-production klinik database');
  }
  const result = await db.begin(async (tx) => {
    const [target] = await tx<{ database: string; user_name: string }[]>`SELECT current_database() AS database, current_user AS user_name`;
    if (target.database !== 'klinik' || target.user_name !== 'klinik') throw new Error('Unexpected database or database user');
    const [user] = await tx<{ id: string; name: string; role: string; job_role: string; disabled_at: Date | null }[]>`
      SELECT id, name, role, job_role, disabled_at FROM staff.users WHERE phone = ${phone} FOR UPDATE
    `;
    if (!user || user.disabled_at || user.role !== 'doctor' || user.job_role !== 'duty_doctor') {
      throw new Error('Phone must belong to an enabled duty doctor');
    }
    const admissions = await tx<{ id: string }[]>`SELECT id FROM clinical.admissions WHERE status = 'active' ORDER BY id FOR UPDATE`;
    if (!admissions.length) return { name: user.name, activeAdmissions: 0, unitsAdded: 0, assignmentsAdded: 0 };
    const ids = admissions.map((admission) => admission.id);
    const memberships = await tx<{ unit_id: string }[]>`
      INSERT INTO staff.unit_memberships (user_id, unit_id, is_primary)
      SELECT DISTINCT ${user.id}::uuid, a.unit_id, false FROM clinical.admissions a
      WHERE a.id IN ${tx(ids)} AND a.unit_id IS NOT NULL
      ON CONFLICT (user_id, unit_id) DO NOTHING RETURNING unit_id
    `;
    const assignments = await tx<{ id: string; admission_id: string }[]>`
      INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type)
      SELECT a.id, ${user.id}::uuid, 'coverage' FROM clinical.admissions a
      WHERE a.id IN ${tx(ids)} AND a.assigned_doctor_id IS DISTINCT FROM ${user.id}::uuid
        AND NOT EXISTS (SELECT 1 FROM clinical.staff_assignments sa WHERE sa.admission_id = a.id AND sa.user_id = ${user.id} AND sa.ends_at IS NULL)
      ON CONFLICT DO NOTHING RETURNING id, admission_id
    `;
    for (const assignment of assignments) {
      await tx`
        INSERT INTO clinical.audit_log (action, record_table, record_id, after)
        VALUES ('assign_test_coverage', 'clinical.staff_assignments', ${assignment.id},
          ${tx.json({ admission_id: assignment.admission_id, user_id: user.id, source: 'local_test_seed' })})
      `;
    }
    return { name: user.name, activeAdmissions: admissions.length, unitsAdded: memberships.length, assignmentsAdded: assignments.length };
  });
  console.log(`${result.name}: ${result.activeAdmissions} active admissions accessible; ${result.assignmentsAdded} coverage assignments and ${result.unitsAdded} unit memberships added.`);
}

try {
  await main();
} finally {
  await db.end();
}
