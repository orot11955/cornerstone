import { createHash, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { validateDatabaseEnvironment } from '../src/config/env.schema.js';
import { buildDatabaseOptions } from '../src/database/database-options.js';
import { IdempotencyRepository } from '../src/database/idempotency.repository.js';
import { OutboxRepository } from '../src/database/outbox.repository.js';
import {
  OutboxWorker,
  TypeOrmOutboxWorkStore,
} from '../src/database/outbox.worker.js';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('Database repositories (integration)', () => {
  let source: DataSource;

  beforeAll(async () => {
    source = new DataSource(
      buildDatabaseOptions(validateDatabaseEnvironment(process.env), 'runtime'),
    );
    await source.initialize();
  });

  beforeEach(async () => {
    await source.query('DELETE FROM idempotency_records');
    await source.query('DELETE FROM outbox_events');
  });

  it('reserves, completes, replays, and conflicts by canonical payload', async () => {
    const repository = new IdempotencyRepository();
    const reservation = {
      scopeHash: digest('user:1'),
      key: 'request-1',
      method: 'POST',
      routeId: 'users.create',
      payloadSha256: digest('{"name":"one"}'),
      expiresAt: new Date(Date.now() + 60_000),
    };

    const first = await source.transaction((manager) =>
      repository.reserve(manager, reservation),
    );
    expect(first.kind).toBe('reserved');
    if (first.kind !== 'reserved') throw new Error('Expected reservation');

    await source.transaction((manager) =>
      repository.complete(manager, {
        recordId: first.recordId,
        status: 201,
        body: { resourceId: randomUUID() },
        resourceVersion: 0,
      }),
    );

    const replay = await source.transaction((manager) =>
      repository.reserve(manager, reservation),
    );
    expect(replay).toMatchObject({ kind: 'replay', status: 201 });

    const conflict = await source.transaction((manager) =>
      repository.reserve(manager, {
        ...reservation,
        payloadSha256: digest('{"name":"other"}'),
      }),
    );
    expect(conflict.kind).toBe('conflict');

    const concurrentReservation = {
      ...reservation,
      key: 'concurrent-request',
    };
    const concurrent = await Promise.all([
      source.transaction((manager) =>
        repository.reserve(manager, concurrentReservation),
      ),
      source.transaction((manager) =>
        repository.reserve(manager, concurrentReservation),
      ),
    ]);
    expect(concurrent.map((result) => result.kind).sort()).toEqual([
      'in_progress',
      'reserved',
    ]);

    await source.query(
      `UPDATE idempotency_records
       SET expires_at = CURRENT_TIMESTAMP - interval '1 second'
       WHERE idempotency_key = 'concurrent-request'`,
    );
    const reused = await source.transaction((manager) =>
      repository.reserve(manager, {
        ...concurrentReservation,
        payloadSha256: digest('{"name":"after-expiry"}'),
      }),
    );
    expect(reused.kind).toBe('reserved');
  });

  it('commits outbox with domain work and reclaims failed leases', async () => {
    const repository = new OutboxRepository();
    const aggregateId = randomUUID();

    await expect(
      source.transaction(async (manager) => {
        await repository.enqueue(manager, {
          eventType: 'identity.user.changed',
          eventVersion: 1,
          aggregateId,
          payload: { userId: aggregateId, changes: ['status'] },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await countRows(source, 'outbox_events')).toBe(0);

    const eventId = await source.transaction((manager) =>
      repository.enqueue(manager, {
        eventType: 'identity.user.changed',
        eventVersion: 1,
        aggregateId,
        payload: { userId: aggregateId, changes: ['status'] },
        maxAttempts: 3,
      }),
    );
    const [first] = await repository.leaseBatch(source, {
      workerId: 'worker-1',
      limit: 10,
      leaseMs: 1_000,
    });
    expect(first).toMatchObject({ id: eventId, attempts: 1 });
    expect(
      await source.transaction((manager) =>
        repository.markFailed(manager, {
          eventId,
          workerId: 'worker-1',
          errorCode: 'PROVIDER_UNAVAILABLE',
          retryAt: new Date(Date.now() - 1),
        }),
      ),
    ).toBe('retry');

    const [second] = await repository.leaseBatch(source, {
      workerId: 'worker-2',
      limit: 10,
      leaseMs: 1_000,
    });
    expect(second).toMatchObject({ id: eventId, attempts: 2 });
    expect(
      await repository.leaseBatch(source, {
        workerId: 'worker-3',
        limit: 10,
        leaseMs: 1_000,
      }),
    ).toEqual([]);
    await source.query(
      `UPDATE outbox_events
       SET locked_at = CURRENT_TIMESTAMP - interval '2 seconds'
       WHERE id = $1`,
      [eventId],
    );

    const [third] = await repository.leaseBatch(source, {
      workerId: 'worker-3',
      limit: 10,
      leaseMs: 1_000,
    });
    expect(third).toMatchObject({ id: eventId, attempts: 3 });
    expect(
      await source.transaction((manager) =>
        repository.markFailed(manager, {
          eventId,
          workerId: 'worker-3',
          errorCode: 'PROVIDER_REJECTED',
          retryAt: new Date(),
        }),
      ),
    ).toBe('poison');
    expect(
      await repository.leaseBatch(source, {
        workerId: 'worker-4',
        limit: 10,
        leaseMs: 1_000,
      }),
    ).toEqual([]);

    const processedId = await source.transaction((manager) =>
      repository.enqueue(manager, {
        eventType: 'identity.user.changed',
        eventVersion: 1,
        aggregateId,
        payload: { userId: aggregateId, changes: ['role'] },
      }),
    );
    await repository.leaseBatch(source, {
      workerId: 'worker-4',
      limit: 10,
      leaseMs: 1_000,
    });
    await source.transaction((manager) =>
      repository.markProcessed(manager, processedId, 'worker-4'),
    );
    expect(
      await repository.leaseBatch(source, {
        workerId: 'worker-5',
        limit: 10,
        leaseMs: 1_000,
      }),
    ).toEqual([]);
  });

  it('delivers outbox events with the event ID as provider idempotency key', async () => {
    const repository = new OutboxRepository();
    const aggregateId = randomUUID();
    const eventId = await source.transaction((manager) =>
      repository.enqueue(manager, {
        eventType: 'identity.user.changed',
        eventVersion: 1,
        aggregateId,
        payload: { userId: aggregateId, changes: ['status'] },
      }),
    );
    const deliveredKeys: string[] = [];
    const worker = new OutboxWorker(
      new TypeOrmOutboxWorkStore(source, repository),
      {
        'identity.user.changed': (_event, context) => {
          deliveredKeys.push(context.idempotencyKey);
          return Promise.resolve();
        },
      },
      {
        workerId: 'integration-worker',
        batchSize: 10,
        leaseMs: 30_000,
        baseRetryMs: 1_000,
        maxRetryMs: 60_000,
      },
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
    expect(deliveredKeys).toEqual([eventId]);
    expect(
      await repository.leaseBatch(source, {
        workerId: 'verification-worker',
        limit: 10,
        leaseMs: 1_000,
      }),
    ).toEqual([]);
  });

  afterAll(async () => {
    await source.destroy();
  });
});

async function countRows(source: DataSource, table: string): Promise<number> {
  if (!['idempotency_records', 'outbox_events'].includes(table)) {
    throw new Error('Unexpected integration table');
  }
  const result: unknown = await source.query(
    `SELECT count(*)::integer AS count FROM ${table}`,
  );
  if (
    !Array.isArray(result) ||
    typeof result[0] !== 'object' ||
    result[0] === null
  ) {
    throw new Error('Count query returned no rows');
  }
  const count = Reflect.get(result[0], 'count') as unknown;
  if (typeof count !== 'number') throw new Error('Count query is not numeric');
  return count;
}
