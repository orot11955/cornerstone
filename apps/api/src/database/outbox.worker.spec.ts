import type { LeasedOutboxEvent } from './outbox.repository.js';
import {
  OutboxWorker,
  type OutboxWorkStore,
  type OutboxWorkerOptions,
} from './outbox.worker.js';

const event: LeasedOutboxEvent = {
  id: '00000000-0000-4000-8000-000000000010',
  eventType: 'identity.user.changed',
  eventVersion: 1,
  aggregateId: '00000000-0000-4000-8000-000000000011',
  payload: { userId: '00000000-0000-4000-8000-000000000011' },
  attempts: 1,
  maxAttempts: 3,
};

const options: OutboxWorkerOptions = {
  workerId: 'worker-1',
  batchSize: 10,
  leaseMs: 30_000,
  baseRetryMs: 1_000,
  maxRetryMs: 60_000,
};

class FakeOutboxStore implements OutboxWorkStore {
  readonly processed: string[] = [];
  readonly failed: string[] = [];
  private batches: Array<readonly LeasedOutboxEvent[]>;

  constructor(...batches: Array<readonly LeasedOutboxEvent[]>) {
    this.batches = batches;
  }

  leaseBatch(): Promise<readonly LeasedOutboxEvent[]> {
    return Promise.resolve(this.batches.shift() ?? []);
  }

  markProcessed(eventId: string): Promise<void> {
    this.processed.push(eventId);
    return Promise.resolve();
  }

  markFailed(
    input: Parameters<OutboxWorkStore['markFailed']>[0],
  ): Promise<'retry'> {
    this.failed.push(input.errorCode);
    return Promise.resolve('retry');
  }
}

describe('OutboxWorker', () => {
  it('passes the event ID as provider idempotency key and marks success', async () => {
    const store = new FakeOutboxStore([event], []);
    const keys: string[] = [];
    const worker = new OutboxWorker(
      store,
      {
        'identity.user.changed': (_event, context) => {
          keys.push(context.idempotencyKey);
          return Promise.resolve();
        },
      },
      options,
    );

    await expect(
      worker.drain(new AbortController().signal, 10),
    ).resolves.toEqual({
      leased: 1,
      processed: 1,
      retry: 0,
      poison: 0,
      interrupted: 0,
    });
    expect(keys).toEqual([event.id]);
    expect(store.processed).toEqual([event.id]);
  });

  it('classifies missing and provider handlers without logging error details', async () => {
    const missingStore = new FakeOutboxStore([event]);
    const missing = new OutboxWorker(missingStore, {}, options);
    await expect(
      missing.runBatch(new AbortController().signal),
    ).resolves.toMatchObject({ retry: 1 });
    expect(missingStore.failed).toEqual(['OUTBOX_HANDLER_MISSING']);

    const failedStore = new FakeOutboxStore([event]);
    const failed = new OutboxWorker(
      failedStore,
      {
        'identity.user.changed': () => {
          const error = new Error('provider token=secret');
          Reflect.set(error, 'code', 'PROVIDER_TIMEOUT');
          return Promise.reject(error);
        },
      },
      options,
    );
    await failed.runBatch(new AbortController().signal);
    expect(failedStore.failed).toEqual(['PROVIDER_TIMEOUT']);
  });

  it('leaves a lease for reclaim when shutdown interrupts delivery', async () => {
    const controller = new AbortController();
    const store = new FakeOutboxStore([event]);
    const worker = new OutboxWorker(
      store,
      {
        'identity.user.changed': () => {
          controller.abort();
          return Promise.resolve();
        },
      },
      options,
    );

    await expect(worker.runBatch(controller.signal)).resolves.toMatchObject({
      interrupted: 1,
      processed: 0,
    });
    expect(store.processed).toEqual([]);
    expect(store.failed).toEqual([]);
  });
});
