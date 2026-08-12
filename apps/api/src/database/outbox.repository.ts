import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { DatabaseTelemetry } from './database-telemetry.js';
import { readQueryRows } from './query-result.js';
import { assertSafeDatabasePayload } from './safe-json.js';

export interface OutboxEventInput {
  readonly eventType: string;
  readonly eventVersion: number;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly availableAt?: Date;
  readonly maxAttempts?: number;
}

export interface LeasedOutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attempts: number;
  readonly maxAttempts: number;
}

@Injectable()
export class OutboxRepository {
  constructor(@Optional() private readonly telemetry?: DatabaseTelemetry) {}

  async enqueue(
    manager: EntityManager,
    event: OutboxEventInput,
  ): Promise<string> {
    return this.observe('outbox.enqueue', () =>
      this.enqueueInternal(manager, event),
    );
  }

  private async enqueueInternal(
    manager: EntityManager,
    event: OutboxEventInput,
  ): Promise<string> {
    validateEvent(event);
    const id = randomUUID();
    await manager.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, aggregate_id, payload,
         attempts, max_attempts, available_at, locked_at, locked_by,
         processed_at, last_error_code, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, 0, $6, COALESCE($7, CURRENT_TIMESTAMP),
         NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )`,
      [
        id,
        event.eventType,
        event.eventVersion,
        event.aggregateId,
        event.payload,
        event.maxAttempts ?? 10,
        event.availableAt ?? null,
      ],
    );
    return id;
  }

  async leaseBatch(
    source: DataSource,
    input: {
      readonly workerId: string;
      readonly limit: number;
      readonly leaseMs: number;
    },
  ): Promise<readonly LeasedOutboxEvent[]> {
    return this.observe('outbox.lease', () =>
      this.leaseBatchInternal(source, input),
    );
  }

  private async leaseBatchInternal(
    source: DataSource,
    input: {
      readonly workerId: string;
      readonly limit: number;
      readonly leaseMs: number;
    },
  ): Promise<readonly LeasedOutboxEvent[]> {
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(input.workerId)) {
      throw new Error('Invalid outbox worker ID');
    }
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new Error('Outbox lease limit must be 1..100');
    }
    if (
      !Number.isInteger(input.leaseMs) ||
      input.leaseMs < 1_000 ||
      input.leaseMs > 300_000
    ) {
      throw new Error('Outbox lease must be 1000..300000ms');
    }

    return source.transaction(async (manager) =>
      queryRows<LeasedOutboxEvent>(
        manager,
        `WITH candidates AS (
           SELECT id
           FROM outbox_events
           WHERE processed_at IS NULL
             AND attempts < max_attempts
             AND available_at <= CURRENT_TIMESTAMP
             AND (locked_at IS NULL OR locked_at < CURRENT_TIMESTAMP - ($3 * interval '1 millisecond'))
           ORDER BY available_at, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE outbox_events AS event
         SET locked_at = CURRENT_TIMESTAMP, locked_by = $1,
           attempts = event.attempts + 1, updated_at = CURRENT_TIMESTAMP
         FROM candidates
         WHERE event.id = candidates.id
         RETURNING event.id, event.event_type AS "eventType",
           event.event_version AS "eventVersion",
           event.aggregate_id AS "aggregateId", event.payload,
           event.attempts, event.max_attempts AS "maxAttempts"`,
        [input.workerId, input.limit, input.leaseMs],
      ),
    );
  }

  async markProcessed(
    manager: EntityManager,
    eventId: string,
    workerId: string,
  ): Promise<void> {
    return this.observe('outbox.complete', () =>
      requireOwnedUpdate(
        manager,
        `UPDATE outbox_events
       SET processed_at = CURRENT_TIMESTAMP, locked_at = NULL, locked_by = NULL,
         last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND locked_by = $2 AND processed_at IS NULL
       RETURNING id`,
        [eventId, workerId],
      ),
    );
  }

  async markFailed(
    manager: EntityManager,
    input: {
      readonly eventId: string;
      readonly workerId: string;
      readonly errorCode: string;
      readonly retryAt: Date;
    },
  ): Promise<'retry' | 'poison'> {
    return this.observe('outbox.fail', () =>
      this.markFailedInternal(manager, input),
    );
  }

  private async markFailedInternal(
    manager: EntityManager,
    input: {
      readonly eventId: string;
      readonly workerId: string;
      readonly errorCode: string;
      readonly retryAt: Date;
    },
  ): Promise<'retry' | 'poison'> {
    if (!/^[A-Z0-9_.:-]{1,64}$/.test(input.errorCode)) {
      throw new Error('Invalid outbox error code');
    }
    const result = await queryRows<{ poison: boolean }>(
      manager,
      `UPDATE outbox_events
       SET processed_at = CASE WHEN attempts >= max_attempts THEN CURRENT_TIMESTAMP ELSE NULL END,
         available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE $4 END,
         locked_at = NULL, locked_by = NULL, last_error_code = $3,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND locked_by = $2 AND processed_at IS NULL
       RETURNING attempts >= max_attempts AS poison`,
      [input.eventId, input.workerId, input.errorCode, input.retryAt],
    );
    const row = result[0];
    if (!row) throw new Error('Outbox worker lost lease ownership');
    return row.poison ? 'poison' : 'retry';
  }

  private observe<T>(operation: string, task: () => Promise<T>): Promise<T> {
    return this.telemetry ? this.telemetry.observe(operation, task) : task();
  }
}

function validateEvent(event: OutboxEventInput): void {
  if (!/^[a-z][a-z0-9.]{2,127}$/.test(event.eventType)) {
    throw new Error('Invalid outbox event type');
  }
  if (!Number.isInteger(event.eventVersion) || event.eventVersion < 1) {
    throw new Error('Invalid outbox event version');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      event.aggregateId,
    )
  ) {
    throw new Error('Invalid outbox aggregate ID');
  }
  const maxAttempts = event.maxAttempts ?? 10;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new Error('Outbox max attempts must be 1..100');
  }
  assertSafeDatabasePayload(event.payload, 'outbox payload');
}

async function requireOwnedUpdate(
  manager: EntityManager,
  sql: string,
  parameters: readonly unknown[],
): Promise<void> {
  const rows = await queryRows<{ id: string }>(manager, sql, parameters);
  if (!rows[0]) throw new Error('Outbox worker lost lease ownership');
}

async function queryRows<T extends object>(
  manager: EntityManager,
  sql: string,
  parameters: readonly unknown[],
): Promise<readonly T[]> {
  const result: unknown = await manager.query(sql, [...parameters]);
  return readQueryRows<T>(result);
}
