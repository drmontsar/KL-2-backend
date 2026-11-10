import { readFileSync } from 'node:fs';
import { demoEmail } from '../src/db/demo_email';

const groups = JSON.parse(readFileSync(new URL('../test-data/staff.json', import.meta.url), 'utf8')) as {
  table: string; rows: { name: string; phone: string }[];
}[];
const staff = groups.find((group) => group.table === 'staff.users')?.rows ?? [];

export function emailForFixturePhone(phone: string): string {
  const user = staff.find((row) => row.phone === phone);
  if (!user) throw new Error(`No fixture account for ${phone}`);
  return demoEmail(user.name);
}
