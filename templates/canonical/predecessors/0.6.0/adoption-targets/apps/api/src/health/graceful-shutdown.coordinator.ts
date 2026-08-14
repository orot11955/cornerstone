import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { StructuredLogger } from '../observability/structured-logger.service.js';
import { HealthService } from './health.service.js';

const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;
export const GRACEFUL_SHUTDOWN_OPTIONS = Symbol('GRACEFUL_SHUTDOWN_OPTIONS');

export interface GracefulShutdownOptions {
  readonly drainTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}

@Injectable()
export class GracefulShutdownCoordinator {
  private readonly drainTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private activeRequests = 0;
  private readonly drainWaiters = new Set<() => void>();
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly health: HealthService,
    private readonly logger: StructuredLogger,
    @Optional()
    @Inject(GRACEFUL_SHUTDOWN_OPTIONS)
    options?: GracefulShutdownOptions,
  ) {
    this.drainTimeoutMs = options?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    this.shutdownTimeoutMs =
      options?.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  trackRequest = (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): void => {
    this.activeRequests += 1;
    let completed = false;
    const complete = (): void => {
      if (completed) return;
      completed = true;
      this.activeRequests -= 1;
      if (this.activeRequests === 0) {
        for (const resolve of this.drainWaiters) resolve();
        this.drainWaiters.clear();
      }
    };
    response.once('finish', complete);
    response.once('close', complete);
    next();
  };

  installSignalHandler(
    server: Server,
    closeApplication: () => Promise<void>,
  ): () => void {
    const handler = (signal: 'SIGINT' | 'SIGTERM'): void => {
      void this.shutdown(server, closeApplication, signal).then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    const sigterm = (): void => handler('SIGTERM');
    const sigint = (): void => handler('SIGINT');
    process.once('SIGTERM', sigterm);
    process.once('SIGINT', sigint);
    return () => {
      process.off('SIGTERM', sigterm);
      process.off('SIGINT', sigint);
    };
  }

  shutdown(
    server: Server,
    closeApplication: () => Promise<void>,
    signal = 'SIGTERM',
  ): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = withTimeout(
      this.performShutdown(server, closeApplication, signal),
      this.shutdownTimeoutMs,
      () => server.closeAllConnections?.(),
    );
    return this.shutdownPromise;
  }

  private async performShutdown(
    server: Server,
    closeApplication: () => Promise<void>,
    signal: string,
  ): Promise<void> {
    this.health.markNotReady();
    this.logger.event('info', 'application.shutdown.started', { signal });
    stopAccepting(server);
    const drained = await this.waitForDrain();
    if (!drained) {
      server.closeAllConnections?.();
      this.logger.event('warn', 'application.shutdown.drain_timeout', {
        count: this.activeRequests,
      });
    }
    await closeApplication();
    this.logger.event('info', 'application.shutdown.completed', {
      outcome: drained ? 'drained' : 'timed_out',
    });
  }

  private async waitForDrain(): Promise<boolean> {
    if (this.activeRequests === 0) return true;
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.drainWaiters.delete(onDrain);
        resolve(false);
      }, this.drainTimeoutMs);
      const onDrain = (): void => {
        clearTimeout(timeout);
        resolve(true);
      };
      this.drainWaiters.add(onDrain);
    });
  }
}

function withTimeout(
  operation: Promise<void>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout();
      reject(new Error('Shutdown deadline exceeded'));
    }, timeoutMs);
    void operation.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error('Shutdown failed'));
      },
    );
  });
}

function stopAccepting(server: Server): void {
  try {
    server.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
      throw error;
    }
  }
}
