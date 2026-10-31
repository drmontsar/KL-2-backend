import assert from 'node:assert/strict';
import { app } from '../../src/app';
import { db } from '../../src/db';
import { createSession } from '../../src/db/queries/auth';
import { createUser, type User } from '../../src/db/queries/users';
import { createPatient } from '../../src/db/queries/patients';
import { createAdmission } from '../../src/db/queries/admissions';

export { assert, db };
export type Actor = { user: User; token: string };

export async function actor(
  role: User['role'] = 'doctor',
  job_role?: User['job_role'],
): Promise<Actor> {
  const phone = `+1${1000000000 + parseInt(crypto.randomUUID().slice(0, 8), 16)}`;
  const user = await createUser({ name: 'Regression staff', phone, role, job_role });
  return { user, token: await createSession(user.id) };
}

export function request(who: Actor, path: string, method = 'GET', body?: unknown) {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function admission(doctor: Actor, nurse?: Actor) {
  const patient = await createPatient({
    name: 'Regression patient',
    dob: '1980-01-01',
    phone: '123456789',
    address: 'Original address',
    abha_id: `reg-${crypto.randomUUID()}`,
    created_by: doctor.user.id,
  });
  const row = await createAdmission({ patient_id: patient.id, created_by: doctor.user.id });
  assert(row);
  await db`UPDATE clinical.admissions SET assigned_doctor_id = ${doctor.user.id}, assigned_to = ${nurse?.user.id ?? null} WHERE id = ${row.id}`;
  return { ...row, patient };
}

export async function withDatabaseFailure(
  table: 'clinical.audit_log' | 'clinical.notifications',
  run: () => Promise<void>,
) {
  assert.equal(process.env.DISPOSABLE_DATABASE, '1');
  await db.unsafe(`CREATE FUNCTION public.regression_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected regression failure'; END $$;
    CREATE TRIGGER regression_fail_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION public.regression_fail_write()`);
  try {
    await run();
  } finally {
    await db.unsafe(
      `DROP TRIGGER regression_fail_write ON ${table}; DROP FUNCTION public.regression_fail_write()`,
    );
  }
}
