import { db } from '../index';

export function listAppliedMigrations() {
  return db<{ name: string }[]>`SELECT name FROM _migrations`;
}
