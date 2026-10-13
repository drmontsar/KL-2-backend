import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { config } from '../config';
import { logger } from '../logger';

const sql = postgres(config.databaseUrl);

await sql`SET client_min_messages = warning`;

await sql`
  CREATE TABLE IF NOT EXISTS _migrations (
    id   serial PRIMARY KEY,
    name text   NOT NULL UNIQUE,
    applied_at timestamp DEFAULT now() NOT NULL
  )
`;

const files = (await readdir('migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

const applied = new Set(
  (await sql`SELECT name FROM _migrations`).map((r) => r.name as string)
);

for (const file of files) {
  if (applied.has(file)) {
    logger.info(`skip: ${file}`);
    continue;
  }

  const content = await readFile(join('migrations', file), 'utf8');
  const match = content.match(/--\s*up\s*\n([\s\S]*?)(?:--\s*down|$)/i);
  if (!match?.[1]?.trim()) {
    throw new Error(`No -- up section found in ${file}`);
  }

  await sql.begin(async (tx) => {
    await tx.unsafe(match[1].trim());
    await tx`INSERT INTO _migrations (name) VALUES (${file})`;
  });

  logger.info(`applied: ${file}`);
}

await sql.end();
logger.info('Migration done');
