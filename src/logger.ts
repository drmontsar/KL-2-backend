import pino from 'pino';
import { config } from './config';

export const logger = pino({
  redact: {
    paths: [
      'authorization',
      'req.headers.authorization',
      'token',
      'otp',
      'password',
      'password_hash',
      'current_password',
      'new_password',
      'email',
      'phone',
      'patient',
      'patient_name',
      'body',
      'payload',
    ],
    censor: '[REDACTED]',
  },
  transport:
    config.nodeEnv === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: process.stdout.isTTY,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
});

export function errorDiagnostics(error: Error) {
  const code = (error as Error & { code?: unknown }).code;
  return {
    errorType: error.name,
    errorCode: typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : undefined,
    // Error messages and PostgreSQL details can contain patient data; keep only frames.
    stack: error.stack
      ?.split('\n')
      .filter((line) => /^\s+at /.test(line))
      .join('\n'),
  };
}
