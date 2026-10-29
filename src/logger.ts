import { config } from './config.js';

const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;

const secretPatterns: Array<[RegExp, string]> = [
  [/wstoken=[^&\s"']+/gi, 'wstoken=[REDACTED]'],
  [/(token=)[^&\s"']+/gi, '$1[REDACTED]'],
  [/(password["']?\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[REDACTED]'],
  [/(MoodleSession=)[^;\s]+/gi, '$1[REDACTED]']
];

export function redact(value: string): string {
  return secretPatterns.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (levels[level] < levels[config.logLevel]) return;
  const payload = {
    time: new Date().toISOString(),
    level,
    message: redact(message),
    ...(fields ?? {})
  };
  const serialized = JSON.stringify(payload, (_key, value) => (typeof value === 'string' ? redact(value) : value));
  process.stderr.write(`${serialized}\n`);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields)
};
