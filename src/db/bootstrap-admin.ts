// Run once on a fresh deployment using environment variables, never CLI password arguments.
import { z } from 'zod';
import { db } from './index';
import { createUser } from './queries/users';
import { setUserCredentials } from './queries/auth';

const email = z.string().email().parse(process.env.ADMIN_EMAIL?.trim().toLowerCase());
const password = z.string().min(12).max(128).parse(process.env.ADMIN_PASSWORD);
const selectedId = process.env.ADMIN_USER_ID;

try {
  const admins = await db<{ id: string }[]>`
    SELECT id FROM staff.users WHERE job_role = 'administrator' AND disabled_at IS NULL ORDER BY id
  `;
  if (selectedId && !admins.some((user) => user.id === selectedId))
    throw new Error('ADMIN_USER_ID must identify an enabled administrator');
  if (!selectedId && admins.length > 1)
    throw new Error('Multiple administrators exist; specify ADMIN_USER_ID');
  const id = selectedId ?? admins[0]?.id;
  if (id) {
    const [existing] = await db`SELECT 1 FROM staff.user_credentials WHERE user_id = ${id}`;
    if (existing) throw new Error('Administrator already has credentials; use the authenticated reset endpoint');
    await setUserCredentials(id, email, password);
  } else {
    await createUser({ name: process.env.ADMIN_NAME?.trim() || 'Administrator', role: 'admin',
      job_role: 'administrator', email, password });
  }
  console.log('Administrator email/password configured.');
} finally {
  await db.end();
}
