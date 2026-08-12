import type { DataSource } from 'typeorm';
import {
  type LeasedOutboxEvent,
  OutboxRepository,
} from './outbox.repository.js';

export interface OutboxDeliveryContext {
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
}

export type OutboxHandler = (
  event: LeasedOutboxEvent,
  context: OutboxDeliveryContext,
) => Promise<void>;

export interface OutboxWorkStore {
  leaseBatch(input: {
    readonly workerId: string;
    readonly limit: number;
    readonly leaseMs: number;
  }): Promise<readonly LeasedOutboxEvent[]>;
  markProcessed(eventId: string, workerId: string): Promise<void>;
  markFailed(input: {
    readonly eventId: string;
    readonly workerId: string;
    readonly errorCode: string;
    readonly retryAt: Date;
  }): Promise<'retry' | 'poison'>;
}

export interface OutboxBatchResult {
  readonly leased: number;
  readonly processed: number;
  readonly retry: number;
  readonly poison: number;
  readonly interrupted: number;
}

export interface OutboxWorkerOptions {
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseMs: number;
  readonly baseRetryMs: number;
  readonly maxRetryMs: number;
}

export class TypeOrmOutboxWorkStore implements OutboxWorkStore {
  constructor(
    private readonly source: DataSource,
    private readonly repository: OutboxRepository,
  ) {}

  leaseBatch(
    input: Parameters<OutboxWorkStore['leaseBatch']>[0],
  ): Promise<readonly LeasedOutboxEvent[]> {
    return this.repository.leaseBatch(this.source, input);
  }

  markProcessed(eventId: string, workerId: string): Promise<void> {
    return this.source.transaction((manager) =>
      this.repository.markProcessed(manager, eventId, workerId),
    );
  }

  markFailed(
    input: Parameters<OutboxWorkStore['markFailed']>[0],
  ): Promise<'retry' | 'poison'> {
    return this.source.transaction((manager) =>
      this.repository.markFailed(manager, input),
    );
  }
}

export class OutboxWorker {
  private readonly handlers: ReadonlyMap<string, OutboxHandler>;

  constructor(
    private readonly store: OutboxWorkStore,
    handlers: Readonly<Record<string, OutboxHandler>>,
    private readonly options: OutboxWorkerOptions,
  ) {
    this.handlers = new Map(Object.entries(handlers));
    validateOptions(options);
  }

  async runBatch(signal: AbortSignal): Promise<OutboxBatchResult> {
    if (signal.aborted) return emptyResult();
    const events = await this.store.leaseBatch({
      workerId: this.options.workerId,
      limit: this.options.batchSize,
      leaseMs: this.options.leaseMs,
    });
    const result = {
      leased: events.length,
      processed: 0,
      retry: 0,
      poison: 0,
      interrupted: 0,
    };

    for (const event of events) {
      if (signal.aborted) {
        result.interrupted += 1;
        continue;
      }
      const handler = this.handlers.get(event.eventType);
      if (!handler) {
        const outcome = await this.store.markFailed({
          eventId: event.id,
          workerId: this.options.workerId,
          errorCode: 'OUTBOX_HANDLER_MISSING',
          retryAt: retryAt(event.attempts, this.options),
        });
        result[outcome] += 1;
        continue;
      }

      try {
        await handler(event, { idempotencyKey: event.id, signal });
        if (signal.aborted) {
          result.interrupted += 1;
          continue;
        }
        await this.store.markProcessed(event.id, this.options.workerId);
        result.processed += 1;
      } catch (error: unknown) {
        if (signal.aborted) {
          result.interrupted += 1;
          continue;
        }
        const outcome = await this.store.markFailed({
          eventId: event.id,
          workerId: this.options.workerId,
          errorCode: deliveryErrorCode(error),
          retryAt: retryAt(event.attempts, this.options),
        });
        result[outcome] += 1;
      }
    }

    return result;
  }

  async drain(
    signal: AbortSignal,
    maxBatches: number,
  ): Promise<OutboxBatchResult> {
    if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 1_000) {
      throw new Error('Outbox max batches must be 1..1000');
    }
    const total = {
      leased: 0,
      processed: 0,
      retry: 0,
      poison: 0,
      interrupted: 0,
    };
    for (let batch = 0; batch < maxBatches && !signal.aborted; batch += 1) {
      const result = await this.runBatch(signal);
      total.leased += result.leased;
      total.processed += result.processed;
      total.retry += result.retry;
      total.poison += result.poison;
      total.interrupted += result.interrupted;
      if (result.leased === 0) break;
    }
    return total;
  }
}

function validateOptions(options: OutboxWorkerOptions): void {
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(options.workerId)) {
    throw new Error('Invalid outbox worker ID');
  }
  if (
    !Number.isInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 100
  ) {
    throw new Error('Outbox batch size must be 1..100');
  }
  if (
    !Number.isInteger(options.leaseMs) ||
    options.leaseMs < 1_000 ||
    options.leaseMs > 300_000
  ) {
    throw new Error('Outbox lease must be 1000..300000ms');
  }
  if (
    !Number.isInteger(options.baseRetryMs) ||
    !Number.isInteger(options.maxRetryMs) ||
    options.baseRetryMs < 1_000 ||
    options.maxRetryMs < options.baseRetryMs ||
    options.maxRetryMs > 24 * 60 * 60 * 1_000
  ) {
    throw new Error('Invalid outbox retry bounds');
  }
}

function retryAt(attempts: number, options: OutboxWorkerOptions): Date {
  const exponent = Math.min(Math.max(0, attempts - 1), 20);
  const delayMs = Math.min(
    options.maxRetryMs,
    options.baseRetryMs * 2 ** exponent,
  );
  return new Date(Date.now() + delayMs);
}

function deliveryErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'DELIVERY_FAILED';
  const code = Reflect.get(error, 'code') as unknown;
  return typeof code === 'string' && /^[A-Z0-9_.:-]{1,64}$/.test(code)
    ? code
    : 'DELIVERY_FAILED';
}

function emptyResult(): OutboxBatchResult {
  return { leased: 0, processed: 0, retry: 0, poison: 0, interrupted: 0 };
}
