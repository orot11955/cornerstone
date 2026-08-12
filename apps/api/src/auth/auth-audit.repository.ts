import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { AuditOutcome } from '../database/entities/audit-event.entity.js';
import { assertSafeDatabasePayload } from '../database/safe-json.js';

export const authAuditEventTypes = [
  'identity.admin.bootstrap',
  'identity.email.verified',
  'identity.login.failed',
  'identity.login.succeeded',
  'identity.logout.succeeded',
  'identity.password.changed',
  'identity.password.reset',
  'identity.refresh.reused',
  'identity.role.changed',
  'identity.session.revoked',
  'identity.status.changed',
  'identity.user.deleted',
] as const;

export type AuthAuditEventType = (typeof authAuditEventTypes)[number];

export interface AuthAuditMetadata {
  readonly factor?: 'password';
  readonly scope?: 'all' | 'current' | 'target';
  readonly fromRole?: 'admin' | 'user';
  readonly toRole?: 'admin' | 'user';
  readonly fromStatus?:
    'active' | 'deleted' | 'pending_verification' | 'suspended';
  readonly toStatus?:
    'active' | 'deleted' | 'pending_verification' | 'suspended';
  readonly familyRevoked?: boolean;
  readonly sessionCount?: number;
  readonly self?: boolean;
}

export interface AuthAuditInput {
  readonly eventType: AuthAuditEventType;
  readonly actorId?: string;
  readonly subjectId?: string;
  readonly resourceId?: string;
  readonly outcome: AuditOutcome;
  readonly reasonCode?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly metadata?: AuthAuditMetadata;
}

@Injectable()
export class AuthAuditRepository {
  async record(manager: EntityManager, event: AuthAuditInput): Promise<string> {
    validateAudit(event);
    const metadata: Readonly<Record<string, unknown>> = {
      ...(event.metadata ?? {}),
    };
    assertSafeDatabasePayload(metadata, 'audit metadata');
    const id = randomUUID();
    await manager.query(
      `INSERT INTO audit_events (
         id, event_type, event_version, actor_id, subject_id, resource_id,
         outcome, reason_code, request_id, trace_id, metadata,
         occurred_at, recorded_at
       ) VALUES (
         $1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )`,
      [
        id,
        event.eventType,
        event.actorId ?? null,
        event.subjectId ?? null,
        event.resourceId ?? null,
        event.outcome,
        event.reasonCode ?? null,
        event.requestId ?? null,
        event.traceId ?? null,
        metadata,
      ],
    );
    return id;
  }
}

function validateAudit(event: AuthAuditInput): void {
  if (!authAuditEventTypes.includes(event.eventType)) {
    throw new TypeError('Invalid audit event type');
  }
  for (const value of [event.actorId, event.subjectId, event.resourceId]) {
    if (value !== undefined && !isSafePrincipalId(value)) {
      throw new TypeError('Invalid audit principal identifier');
    }
  }
  if (
    event.reasonCode !== undefined &&
    !/^[A-Z0-9_.:-]{1,64}$/.test(event.reasonCode)
  ) {
    throw new TypeError('Invalid audit reason code');
  }
  if (
    event.requestId !== undefined &&
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(event.requestId)
  ) {
    throw new TypeError('Invalid audit request ID');
  }
  if (event.traceId !== undefined && !/^[0-9a-f]{32}$/.test(event.traceId)) {
    throw new TypeError('Invalid audit trace ID');
  }
  validateMetadata(event.metadata ?? {});
}

function isSafePrincipalId(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ) ||
    /^system:[a-z][a-z0-9-]{1,63}$/.test(value) ||
    /^hash:[0-9a-f]{64}$/.test(value)
  );
}

function validateMetadata(metadata: AuthAuditMetadata): void {
  const allowedKeys = new Set([
    'factor',
    'scope',
    'fromRole',
    'toRole',
    'fromStatus',
    'toStatus',
    'familyRevoked',
    'sessionCount',
    'self',
  ]);
  if (Object.keys(metadata).some((key) => !allowedKeys.has(key))) {
    throw new TypeError('Audit metadata contains an unsupported field');
  }
  if (metadata.factor !== undefined && metadata.factor !== 'password') {
    throw new TypeError('Invalid audit authentication factor');
  }
  if (
    metadata.scope !== undefined &&
    !['all', 'current', 'target'].includes(metadata.scope)
  ) {
    throw new TypeError('Invalid audit session scope');
  }
  for (const role of [metadata.fromRole, metadata.toRole]) {
    if (role !== undefined && !['user', 'admin'].includes(role)) {
      throw new TypeError('Invalid audit role');
    }
  }
  for (const status of [metadata.fromStatus, metadata.toStatus]) {
    if (
      status !== undefined &&
      !['pending_verification', 'active', 'suspended', 'deleted'].includes(
        status,
      )
    ) {
      throw new TypeError('Invalid audit status');
    }
  }
  if (
    metadata.sessionCount !== undefined &&
    (!Number.isSafeInteger(metadata.sessionCount) ||
      metadata.sessionCount < 0 ||
      metadata.sessionCount > 10_000)
  ) {
    throw new TypeError('Invalid audit session count');
  }
  if (
    (metadata.familyRevoked !== undefined &&
      typeof metadata.familyRevoked !== 'boolean') ||
    (metadata.self !== undefined && typeof metadata.self !== 'boolean')
  ) {
    throw new TypeError('Invalid audit boolean metadata');
  }
}
