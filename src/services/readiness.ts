import { readdir } from 'node:fs/promises';
import { listAppliedMigrations } from '../db/queries/health';

export async function isReady() {
  try {
    const [files, applied] = await Promise.all([readdir('migrations'), listAppliedMigrations()]);
    const names = new Set(applied.map((row) => row.name));
    return files.every((name) => !name.endsWith('.sql') || names.has(name));
  } catch {
    return false;
  }
}
