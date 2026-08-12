import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DatabaseTelemetry } from './database-telemetry.js';
import { readQueryRows } from './query-result.js';
import { assertSafeDatabasePayload } from './safe-json.js';

export interface IdempotencyReservation {
  readonly scopeHash: string;
  readonly key: string;
  readonly method: string;
  readonly routeId: string;
  readonly payloadSha256: string;
  readonly expiresAt: Date;
}

export type IdempotencyReserveResult =
  | { readonly kind: 'reserved'; readonly recordId: string }
  | { readonly kind: 'in_progress'; readonly recordId: string }
  | {
      readonly kind: 'replay';
      readonly recordId: string;
      readonly status: number;
      readonly body: Readonly<Record<string, unknown>> | null;
    }
  | { readonly kind: 'conflict'; readonly recordId: string };

interface IdempotencyRow {
  readonly id: string;
  readonly payloadSha256: string;
  readonly state: 'pending' | 'completed';
  readonly responseStatus: number | null;
  readonly responseBody: Readonly<Record<string, unknown>> | null;
  readonly expiresAt: Date;
}

@Injectable()
export class IdempotencyRepository {
  constructor(@Optional() private readonly telemetry?: DatabaseTelemetry) {}

  async reserve(
    manager: EntityManager,
    reservation: IdempotencyReservation,
  ): Promise<IdempotencyReserveResult> {
    return this.observe('idempotency.reserve', () =>
      this.reserveInternal(manager, reservation),
    );
  }

  private async reserveInternal(
    manager: EntityManager,
    reservation: IdempotencyReservation,
  ): Promise<IdempotencyReserveResult> {
    validateReservation(reservation);
    const id = randomUUID();
    const now = new Date();
    const inserted = await queryRows<IdempotencyRow>(
      manager,
      `INSERT INTO idempotency_records (
         id, scope_hash, idempotency_key, method, route_id, payload_sha256,
         state, response_status, response_body, resource_version,
         expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', NULL, NULL, NULL, $7, $8, $8)
       ON CONFLICT (scope_hash, idempotency_key, method, route_id) DO NOTHING
       RETURNING id, payload_sha256 AS "payloadSha256", state,
         response_status AS "responseStatus", response_body AS "responseBody",
         expires_at AS "expiresAt"`,
      [
        id,
        reservation.scopeHash,
        reservation.key,
        reservation.method,
        reservation.routeId,
        reservation.payloadSha256,
        reservation.expiresAt,
        now,
      ],
    );
    if (inserted[0]) return { kind: 'reserved', recordId: inserted[0].id };

    const existing = await queryRows<IdempotencyRow>(
      manager,
      `SELECT id, payload_sha256 AS "payloadSha256", state,
         response_status AS "responseStatus", response_body AS "responseBody",
         expires_at AS "expiresAt"
       FROM idempotency_records
       WHERE scope_hash = $1 AND idempotency_key = $2
         AND method = $3 AND route_id = $4
       FOR UPDATE`,
      [
        reservation.scopeHash,
        reservation.key,
        reservation.method,
        reservation.routeId,
      ],
    );
    const row = existing[0];
    if (!row) throw new Error('Idempotency record disappeared during reserve');
    if (row.expiresAt.getTime() <= now.getTime()) {
      await manager.query(
        `UPDATE idempotency_records
         SET payload_sha256 = $2, state = 'pending', response_status = NULL,
           response_body = NULL, resource_version = NULL,
           expires_at = $3, updated_at = $4
         WHERE id = $1`,
        [row.id, reservation.payloadSha256, reservation.expiresAt, now],
      );
      return { kind: 'reserved', recordId: row.id };
    }
    if (row.payloadSha256 !== reservation.payloadSha256) {
      return { kind: 'conflict', recordId: row.id };
    }
    if (row.state === 'completed') {
      if (row.responseStatus === null) {
        throw new Error('Completed idempotency record has no response status');
      }
      return {
        kind: 'replay',
        recordId: row.id,
        status: row.responseStatus,
        body: row.responseBody,
      };
    }
    return { kind: 'in_progress', recordId: row.id };
  }

  async complete(
    manager: EntityManager,
    input: {
      readonly recordId: string;
      readonly status: number;
      readonly body: Readonly<Record<string, unknown>> | null;
      readonly resourceVersion?: number;
    },
  ): Promise<void> {
    return this.observe('idempotency.complete', () =>
      this.completeInternal(manager, input),
    );
  }

  private async completeInternal(
    manager: EntityManager,
    input: {
      readonly recordId: string;
      readonly status: number;
      readonly body: Readonly<Record<string, unknown>> | null;
      readonly resourceVersion?: number;
    },
  ): Promise<void> {
    if (
      !Number.isInteger(input.status) ||
      input.status < 100 ||
      input.status > 599
    ) {
      throw new Error('Idempotency response status must be 100..599');
    }
    if (input.body) assertSafeDatabasePayload(input.body, 'idempotency body');

    const result = await queryRows<{ id: string }>(
      manager,
      `UPDATE idempotency_records
       SET state = 'completed', response_status = $2, response_body = $3,
         resource_version = $4, updated_at = $5
       WHERE id = $1 AND state = 'pending' AND expires_at > $5
       RETURNING id`,
      [
        input.recordId,
        input.status,
        input.body,
        input.resourceVersion ?? null,
        new Date(),
      ],
    );
    if (!result[0]) throw new Error('Idempotency completion lost ownership');
  }

  private observe<T>(operation: string, task: () => Promise<T>): Promise<T> {
    return this.telemetry ? this.telemetry.observe(operation, task) : task();
  }
}

function validateReservation(reservation: IdempotencyReservation): void {
  if (!/^[0-9a-f]{64}$/.test(reservation.scopeHash)) {
    throw new Error('Invalid idempotency scope hash');
  }
  if (!/^[0-9a-f]{64}$/.test(reservation.payloadSha256)) {
    throw new Error('Invalid idempotency payload digest');
  }
  if (!/^[A-Z]{3,10}$/.test(reservation.method)) {
    throw new Error('Invalid idempotency method');
  }
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(reservation.routeId)) {
    throw new Error('Invalid idempotency route ID');
  }
  if (
    reservation.key.length < 1 ||
    reservation.key.length > 128 ||
    [...reservation.key].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 33 || code > 126;
    })
  ) {
    throw new Error('Invalid idempotency key');
  }
  const ttlMs = reservation.expiresAt.getTime() - Date.now();
  if (ttlMs <= 0 || ttlMs > 24 * 60 * 60 * 1_000) {
    throw new Error('Idempotency expiry must be within 24 hours');
  }
}

async function queryRows<T extends object>(
  manager: EntityManager,
  sql: string,
  parameters: readonly unknown[],
): Promise<readonly T[]> {
  const result: unknown = await manager.query(sql, [...parameters]);
  return readQueryRows<T>(result);
}
