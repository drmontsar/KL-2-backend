// Run after migrations with DATABASE_URL configured: bun run test/duty-coverage-integration.ts
import { db } from '../src/db';
import { admissionAccessFilter } from '../src/db/queries/admissions';
import { createSession, deleteSession } from '../src/db/queries/auth';

try {
  const [all] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM clinical.admissions WHERE status = 'active'`;
  const [visible] = await db<{ count: number }[]>`
    SELECT count(*)::int AS count FROM clinical.admissions a
    WHERE a.status = 'active' AND ${admissionAccessFilter({
      id: '00000000-0000-0000-0000-000000000001', role: 'doctor', job_role: 'duty_doctor',
    })}
  `;
  if (visible.count !== all.count) throw new Error('duty doctor cannot access all active admissions');

  const [user] = await db<{ id: string }[]>`SELECT id FROM staff.users WHERE job_role = 'duty_doctor' AND disabled_at IS NULL LIMIT 1`;
  if (user) {
    const token = await createSession(user.id, 'night');
    try {
      const [session] = await db<{ selected_shift: string }[]>`
        SELECT selected_shift FROM staff.sessions WHERE token = ${token}
      `;
      if (session?.selected_shift !== 'night') throw new Error('selected login shift was not saved');
    } finally {
      await deleteSession(token);
    }
  }
  console.log('Duty-doctor access and session shift checks passed');
} finally {
  await db.end();
}
