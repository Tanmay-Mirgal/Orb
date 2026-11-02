import pino, { type Logger } from 'pino';

export type { Logger };

export function createLogger(service: string): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['password', '*.password', 'authorization', '*.authorization', 'token', '*.token', 'secret', '*.secret'],
      censor: '[redacted]',
    },
  });
}
