import { MetricsService } from './metrics.service.js';
import {
  sanitizeLogMessage,
  StructuredLogger,
} from './structured-logger.service.js';

describe('StructuredLogger', () => {
  it('redacts secret-like values and omits non-string errors', () => {
    expect(
      sanitizeLogMessage('authorization=Bearer-abc password=hunter2'),
    ).toBe('authorization=[REDACTED] password=[REDACTED]');
    expect(sanitizeLogMessage(new Error('token=secret'))).toBe(
      '[non-string message omitted]',
    );
  });

  it('writes only structured safe fields', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger((line) => lines.push(line));
    logger.event('info', 'http.request.completed', {
      requestId: 'request_123',
      count: 1,
      ignored: undefined,
      email: 'private@example.com',
    });
    const event = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(event).toMatchObject({
      level: 'info',
      event: 'http.request.completed',
      requestId: 'request_123',
      count: 1,
    });
    expect(event).not.toHaveProperty('ignored');
    expect(event).not.toHaveProperty('email');
  });
});

describe('MetricsService', () => {
  it('bounds route and status cardinality', () => {
    const metrics = new MetricsService();
    metrics.recordHttp('GET AppController.getHello', 200, 12);
    metrics.recordHttp('GET AppController.getHello', 201, 8);
    metrics.recordHttp('GET /users/private@example.com', 500, 3);
    expect(metrics.snapshot()).toEqual([
      {
        routeId: 'GET AppController.getHello',
        statusClass: '2xx',
        count: 2,
        durationMsTotal: 20,
      },
      {
        routeId: 'UNKNOWN unknown',
        statusClass: '5xx',
        count: 1,
        durationMsTotal: 3,
      },
    ]);
  });
});
