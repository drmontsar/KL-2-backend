import { existsSync, readFileSync } from 'node:fs';

function loadEnvFile(fileName = '.env') {
  if (!existsSync(fileName)) return;

  for (const line of readFileSync(fileName, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();
    const unwrapped =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;

    if (!process.env[key]) process.env[key] = unwrapped;
  }
}

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const nodeEnv = process.env.NODE_ENV ?? 'development';
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : nodeEnv === 'production'
    ? []
    : ['http://localhost:3000', 'http://localhost:5173'];

export const config = {
  databaseUrl,
  port: Number(process.env.PORT) || 3001,
  nodeEnv,
  corsOrigins,
};
