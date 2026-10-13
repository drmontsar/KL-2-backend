import pino from 'pino';
import { config } from './config';

export const logger = pino({
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
