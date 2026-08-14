import { Test, type TestingModule } from '@nestjs/testing';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { MetricsService } from '../observability/metrics.service.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { requestContextMiddleware } from '../observability/request-context.js';
import { StructuredLogger } from '../observability/structured-logger.service.js';
import { OutboundRequestError } from './outbound-http.client.js';
import {
  OUTBOUND_HTTP_CLIENT,
  OutboundHttpModule,
} from './outbound-http.module.js';
import type { OutboundHttpPort } from './outbound-http.adapter.js';

let fixtureBaseUrl = '';

describe('OutboundHttpModule loopback contract', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: IncomingMessage | undefined;

  beforeAll(async () => {
    server = createServer((request, response) => {
      lastRequest = request;
      switch (request.url) {
        case '/provider/ok':
          response.end('ok');
          return;
        case '/provider/redirect':
          response.writeHead(302, { location: '/provider/ok' }).end();
          return;
        case '/provider/large':
          response.writeHead(200, { 'content-length': '5' }).end('large');
          return;
        case '/provider/slow':
          return;
        case '/provider/failure':
          request.socket.destroy();
          return;
        default:
          response.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    baseUrl = `http://127.0.0.1:${address.port}/provider/`;
    fixtureBaseUrl = baseUrl;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
  });

  it('uses a fixed base URL and links request context, trace, and metrics', async () => {
    const module = await createModule();
    const client = module.get<OutboundHttpPort>(OUTBOUND_HTTP_CLIENT);
    let response: Awaited<ReturnType<OutboundHttpPort['request']>> | undefined;
    requestContextMiddleware(
      {
        get: (name: string) =>
          name === 'x-request-id' ? 'request_123' : undefined,
      } as never,
      { setHeader: () => undefined, locals: {} } as never,
      () => {
        void client.request('ok').then((value) => {
          response = value;
        });
      },
    );
    await waitFor(() => response !== undefined);
    expect(response?.status).toBe(200);
    expect(lastRequest?.url).toBe('/provider/ok');
    expect(lastRequest?.headers['x-request-id']).toBe('request_123');
    expect(lastRequest?.headers.traceparent).toMatch(
      /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/,
    );
    expect(module.get(MetricsService).outboundHttpSnapshot()).toEqual([
      expect.objectContaining({
        operation: 'outbound.request',
        outcome: 'success',
        count: 1,
      }),
    ]);
    await module.close();
  });

  it('rejects redirects, bounded bodies, timeout, cancellation, and an open circuit', async () => {
    const module = await createModule({
      timeoutMs: 30,
      maxResponseBytes: 4,
      failureThreshold: 2,
    });
    const client = module.get<OutboundHttpPort>(OUTBOUND_HTTP_CLIENT);
    await expect(client.request('redirect')).rejects.toMatchObject({
      code: 'REDIRECT_REJECTED',
    });
    await expect(client.request('ok')).resolves.toMatchObject({ status: 200 });
    await expect(client.request('large')).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
    await expect(client.request('ok')).resolves.toMatchObject({ status: 200 });
    await expect(client.request('slow')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    await expect(client.request('ok')).resolves.toMatchObject({ status: 200 });

    const abort = new AbortController();
    const cancelled = client.request('slow', { signal: abort.signal });
    abort.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(client.request('failure')).rejects.toBeInstanceOf(
      OutboundRequestError,
    );
    await expect(client.request('failure')).rejects.toMatchObject({
      code: 'NETWORK_FAILURE',
    });
    await expect(client.request('failure')).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN',
    });
    expect(
      module
        .get(MetricsService)
        .outboundHttpSnapshot()
        .find((metric) => metric.outcome === 'failure')?.count,
    ).toBeGreaterThanOrEqual(6);
    await module.close();
  });
});

async function createModule(
  overrides: {
    readonly timeoutMs?: number;
    readonly maxResponseBytes?: number;
    readonly failureThreshold?: number;
  } = {},
): Promise<TestingModule> {
  return await Test.createTestingModule({
    imports: [
      ObservabilityModule,
      OutboundHttpModule.register({
        baseUrl: fixtureBaseUrl,
        timeoutMs: overrides.timeoutMs ?? 500,
        maxResponseBytes: overrides.maxResponseBytes ?? 1024,
        failureThreshold: overrides.failureThreshold ?? 5,
      }),
    ],
  })
    .overrideProvider(StructuredLogger)
    .useValue({ event: () => undefined })
    .compile();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for outbound response');
}
