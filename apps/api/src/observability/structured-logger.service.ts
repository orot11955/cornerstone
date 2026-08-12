import { Injectable, type LoggerService } from '@nestjs/common';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<
  Record<string, string | number | boolean | undefined>
>;
type LogWriter = (line: string) => void;
const ALLOWED_FIELDS = new Set([
  'code',
  'context',
  'count',
  'durationMs',
  'errorType',
  'message',
  'requestId',
  'routeId',
  'status',
  'traceId',
]);
const SENSITIVE_FIELD = /authorization|cookie|password|secret|token/i;

@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly writer: LogWriter;

  constructor(writer?: LogWriter) {
    this.writer = writer ?? ((line) => process.stdout.write(`${line}\n`));
  }

  event(level: LogLevel, event: string, fields: LogFields = {}): void {
    this.writer(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event: sanitizeIdentifier(event),
        ...sanitizeFields(fields),
      }),
    );
  }

  log(message: unknown, context?: string): void {
    this.nestEvent('info', message, context);
  }

  warn(message: unknown, context?: string): void {
    this.nestEvent('warn', message, context);
  }

  error(message: unknown, _trace?: string, context?: string): void {
    this.nestEvent('error', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.nestEvent('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.nestEvent('debug', message, context);
  }

  private nestEvent(level: LogLevel, message: unknown, context?: string): void {
    this.event(level, 'application.log', {
      message: sanitizeLogMessage(message),
      ...(context ? { context: sanitizeIdentifier(context) } : {}),
    });
  }
}

export function sanitizeLogMessage(value: unknown): string {
  if (typeof value !== 'string') return '[non-string message omitted]';
  return value
    .slice(0, 500)
    .replace(
      /\b(authorization|cookie|password|secret|token)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    );
}

function sanitizeIdentifier(value: string): string {
  return /^[A-Za-z0-9_.:/ -]{1,120}$/.test(value) ? value : 'invalid';
}

function sanitizeFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(
        ([key, value]) =>
          ALLOWED_FIELDS.has(key) &&
          ['string', 'number', 'boolean'].includes(typeof value),
      )
      .map(([key, value]) => [
        key,
        SENSITIVE_FIELD.test(key)
          ? '[REDACTED]'
          : typeof value === 'string'
            ? sanitizeLogMessage(value)
            : value,
      ]),
  );
}
