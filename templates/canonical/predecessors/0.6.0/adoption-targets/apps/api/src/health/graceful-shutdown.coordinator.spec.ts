import { ServiceUnavailableException } from '@nestjs/common';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import { GracefulShutdownCoordinator } from './graceful-shutdown.coordinator.js';
import { HealthService } from './health.service.js';
import { StructuredLogger } from '../observability/structured-logger.service.js';

describe('GracefulShutdownCoordinator', () => {
  let server: Server;
  let serverClosed: Promise<unknown[]>;

  afterEach(async () => {
    if (server.listening) {
      server.closeAllConnections?.();
      server.close();
    }
    await serverClosed;
  });

  it('marks readiness down before draining an in-flight HTTP request', async () => {
    const health = new HealthService();
    const coordinator = new GracefulShutdownCoordinator(
      health,
      new StructuredLogger(() => undefined),
      { drainTimeoutMs: 250 },
    );
    let release: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      server = createServer((request, response) => {
        coordinator.trackRequest(request as never, response as never, () => {
          resolve();
          release = () => response.end('drained');
        });
      });
      serverClosed = once(server, 'close');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');

    const pendingResponse = fetch(`http://127.0.0.1:${address.port}/hold`);
    await requestStarted;
    const shutdown = coordinator.shutdown(
      server,
      () => Promise.resolve(),
      'SIGTERM',
    );
    await expect(health.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    release?.();
    await expect(
      pendingResponse.then((response) => response.text()),
    ).resolves.toBe('drained');
    await expect(shutdown).resolves.toBeUndefined();
  });

  it('bounds a stalled HTTP drain and closes live connections', async () => {
    const coordinator = new GracefulShutdownCoordinator(
      new HealthService(),
      new StructuredLogger(() => undefined),
      { drainTimeoutMs: 30 },
    );
    const requestStarted = new Promise<void>((resolve) => {
      server = createServer((request, response) => {
        coordinator.trackRequest(request as never, response as never, () => {
          resolve();
          void response;
        });
      });
      serverClosed = once(server, 'close');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    void fetch(`http://127.0.0.1:${address.port}/hold`).catch(() => undefined);
    await requestStarted;

    const startedAt = performance.now();
    await coordinator.shutdown(server, () => Promise.resolve(), 'SIGTERM');
    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it('bounds a hanging application close after HTTP drain', async () => {
    const coordinator = new GracefulShutdownCoordinator(
      new HealthService(),
      new StructuredLogger(() => undefined),
      { drainTimeoutMs: 10, shutdownTimeoutMs: 30 },
    );
    server = createServer();
    serverClosed = once(server, 'close');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const startedAt = performance.now();
    await expect(
      coordinator.shutdown(server, () => new Promise<void>(() => undefined)),
    ).rejects.toThrow('Shutdown deadline exceeded');
    expect(performance.now() - startedAt).toBeLessThan(200);
  });

  it('installs and removes idempotent SIGTERM and SIGINT handlers', async () => {
    const coordinator = new GracefulShutdownCoordinator(
      new HealthService(),
      new StructuredLogger(() => undefined),
    );
    server = createServer();
    serverClosed = once(server, 'close');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const sigtermListeners = process.listenerCount('SIGTERM');
    const sigintListeners = process.listenerCount('SIGINT');
    const remove = coordinator.installSignalHandler(server, () =>
      Promise.resolve(),
    );
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners + 1);
    expect(process.listenerCount('SIGINT')).toBe(sigintListeners + 1);
    remove();
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
    expect(process.listenerCount('SIGINT')).toBe(sigintListeners);
    server.close();
  });

  it('handles SIGTERM in a child HTTP process after its in-flight request drains', async () => {
    const fixture = fileURLToPath(
      new URL('./graceful-shutdown.fixture.ts', import.meta.url),
    );
    const child = spawn(
      process.execPath,
      ['--loader', 'ts-node/esm', fixture],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    const port = await waitForMatch(() => output.match(/PORT:(\d+)/)?.[1]);
    const pending = fetch(`http://127.0.0.1:${port}/hold`);
    await waitForMatch(() => (output.includes('HOLD') ? 'HOLD' : undefined));
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await expect(pending.then((response) => response.text())).resolves.toBe(
      'drained',
    );
    await expect(exit).resolves.toEqual([0, null]);
  });

  it('exits nonzero when closeApplication exceeds the shutdown deadline', async () => {
    const fixture = fileURLToPath(
      new URL('./graceful-shutdown.fixture.ts', import.meta.url),
    );
    const child = spawn(
      process.execPath,
      ['--loader', 'ts-node/esm', fixture],
      {
        cwd: process.cwd(),
        env: { ...process.env, CLOSE_HANG: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    await waitForMatch(() => output.match(/PORT:(\d+)/)?.[1]);
    const exit = once(child, 'exit');
    child.kill('SIGINT');
    await expect(exit).resolves.toEqual([1, null]);
  });
});

async function waitForMatch(match: () => string | undefined): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = match();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for child fixture');
}
