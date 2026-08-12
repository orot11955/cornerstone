import { DatabaseTelemetry } from './database-telemetry.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.service.js';

describe('DatabaseTelemetry', () => {
  it('records bounded success and failure without SQL or parameters', async () => {
    const lines: string[] = [];
    const metrics = new MetricsService();
    const telemetry = new DatabaseTelemetry(
      metrics,
      new StructuredLogger((line) => lines.push(line)),
    );

    await expect(
      telemetry.observe('outbox.lease', () => Promise.resolve('done')),
    ).resolves.toBe('done');
    const error = new Error('query token=secret SELECT * FROM users');
    Reflect.set(error, 'code', '23505');
    await expect(
      telemetry.observe('idempotency.reserve', () => Promise.reject(error)),
    ).rejects.toThrow();

    expect(metrics.databaseSnapshot()).toEqual([
      expect.objectContaining({
        operation: 'idempotency.reserve',
        outcome: 'failure',
      }),
      expect.objectContaining({
        operation: 'outbox.lease',
        outcome: 'success',
      }),
    ]);
    expect(lines.join('\n')).not.toContain('SELECT');
    expect(lines.join('\n')).not.toContain('secret');
    expect(lines.join('\n')).toContain('23505');
  });
});
