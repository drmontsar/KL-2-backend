import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile();

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
