import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthenticatedPrincipal } from '../auth/auth-lifecycle.service.js';
import { AuthAuditRepository } from '../auth/auth-audit.repository.js';
import {
  AUTH_SECURITY_OPTIONS,
  type AuthSecurityOptions,
} from '../auth/auth-security.options.js';
import type {
  UpdateUserRoleRequestDto,
  UserListQueryDto,
  UserListResponseDto,
  UserResponseDto,
} from '../contracts/user.dto.js';
import { toUserResponse } from '../contracts/user.mapper.js';
import { IdempotencyRepository } from '../database/idempotency.repository.js';
import {
  identityIdempotencyKey,
  identityIdempotencyScope,
} from '../database/idempotency-identity.js';
import { OutboxRepository } from '../database/outbox.repository.js';
import type { UserEntity } from '../database/entities/user.entity.js';
import {
  deletedEmail,
  assertUserStatusTransition,
} from '../identity/identity.contract.js';
import {
  hashCanonicalPayload,
  parseStrongEtag,
  validateIdempotencyKey,
} from '../http/request-contract.js';
import { getRequestContext } from '../observability/request-context.js';
import { readQueryRows } from '../database/query-result.js';

type MutationHeaders = {
  readonly ifMatch: string | undefined;
  readonly idempotencyKey: string | undefined;
};

type UserRow = UserEntity;

@Injectable()
export class UsersService {
  constructor(
    private readonly source: DataSource,
    private readonly idempotency: IdempotencyRepository,
    private readonly audit: AuthAuditRepository,
    private readonly outbox: OutboxRepository,
    @Inject(AUTH_SECURITY_OPTIONS)
    private readonly authOptions: AuthSecurityOptions,
  ) {}

  async list(query: UserListQueryDto): Promise<UserListResponseDto> {
    const offset = (query.page - 1) * query.pageSize;
    const where = query.status ? 'WHERE status = $1' : '';
    const parameters: unknown[] = query.status
      ? [query.status, query.pageSize, offset]
      : [query.pageSize, offset];
    const limitIndex = query.status ? '$2' : '$1';
    const offsetIndex = query.status ? '$3' : '$2';
    const [items, count] = await Promise.all([
      rows<UserRow>(
        this.source,
        `SELECT ${userColumns} FROM users ${where}
         ORDER BY created_at DESC, id ASC LIMIT ${limitIndex} OFFSET ${offsetIndex}`,
        parameters,
      ),
      rows<{ total: string }>(
        this.source,
        `SELECT COUNT(*)::text AS total FROM users ${where}`,
        query.status ? [query.status] : [],
      ),
    ]);
    return {
      items: items.map(toUserResponse),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(count[0]?.total ?? 0),
    };
  }

  async get(userId: string): Promise<UserResponseDto> {
    const user = (
      await rows<UserRow>(
        this.source,
        `SELECT ${userColumns} FROM users WHERE id = $1`,
        [userId],
      )
    )[0];
    if (!user) throw new NotFoundException();
    return toUserResponse(user);
  }

  async deleteCurrentUser(
    principal: AuthenticatedPrincipal,
    headers: MutationHeaders,
  ): Promise<void> {
    const expectedVersion = requiredEtag(headers.ifMatch);
    const key = requiredIdempotencyKey(headers.idempotencyKey);
    const payload = { id: principal.user.id, expectedVersion };
    await this.source.transaction(async (manager) => {
      const reservation = await this.reserve(
        manager,
        principal.user.id,
        key,
        'deleteCurrentUser',
        payload,
      );
      if (typeof reservation !== 'string') return;
      await lockUser(manager, principal.user.id);
      await requireRecentAuthentication(manager, principal);
      const user = await lockedUser(manager, principal.user.id);
      if (!user) throw new NotFoundException();
      assertVersion(user, expectedVersion);
      if (user.status === 'deleted') throw new ConflictException();
      if (user.role === 'admin' && user.status === 'active') {
        await assertNotLastActiveAdmin(manager, user.id);
      }
      const updated = (
        await rows<UserRow>(
          manager,
          `UPDATE users SET email_normalized = $2, password_hash = NULL,
           status = 'deleted', role = 'user', deleted_at = CURRENT_TIMESTAMP,
           suspended_at = NULL, authz_version = authz_version + 1,
           version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING ${userColumns}`,
          [user.id, deletedEmail(user.id)],
        )
      )[0];
      if (!updated) throw new Error('Deleted user update was lost');
      await revokeCredentials(manager, user.id, 'USER_DELETED');
      await this.audit.record(
        manager,
        auditInput('identity.user.deleted', principal.user.id, user.id, {
          fromStatus: user.status,
          toStatus: 'deleted',
          self: true,
          scope: 'all',
        }),
      );
      await this.outbox.enqueue(manager, {
        eventType: 'identity.user.delete.journaled',
        eventVersion: 1,
        aggregateId: user.id,
        payload: { userId: user.id, version: updated.version },
      });
      await this.idempotency.complete(manager, {
        recordId: reservation,
        status: 204,
        body: null,
        resourceVersion: updated.version,
      });
    });
  }

  async updateRole(
    principal: AuthenticatedPrincipal,
    userId: string,
    role: UpdateUserRoleRequestDto['role'],
    headers: MutationHeaders,
  ): Promise<UserResponseDto> {
    if (principal.user.id === userId) throw new ForbiddenException();
    return this.mutate(
      principal,
      userId,
      headers,
      'updateUserRole',
      { userId, role, expectedVersion: requiredEtag(headers.ifMatch) },
      async (manager, user) => {
        if (user.status !== 'active') throw new ConflictException();
        if (user.role === role) throw new ConflictException();
        if (
          user.role === 'admin' &&
          user.status === 'active' &&
          role === 'user'
        )
          await assertNotLastActiveAdmin(manager, user.id);
        const updated = await updateUser(manager, user.id, `role = $2`, [role]);
        await revokeCredentials(manager, user.id, 'ROLE_CHANGED');
        await this.audit.record(
          manager,
          auditInput('identity.role.changed', principal.user.id, user.id, {
            fromRole: user.role,
            toRole: role,
            self: principal.user.id === user.id,
            scope: 'all',
          }),
        );
        await this.outbox.enqueue(manager, {
          eventType: 'identity.role.changed',
          eventVersion: 1,
          aggregateId: user.id,
          payload: { userId: user.id, role, version: updated.version },
        });
        return updated;
      },
    );
  }

  async updateStatus(
    principal: AuthenticatedPrincipal,
    userId: string,
    status: UserEntity['status'],
    headers: MutationHeaders,
  ): Promise<UserResponseDto> {
    if (principal.user.id === userId) throw new ForbiddenException();
    return this.mutate(
      principal,
      userId,
      headers,
      'updateUserStatus',
      { userId, status, expectedVersion: requiredEtag(headers.ifMatch) },
      async (manager, user) => {
        if (user.status === 'pending_verification' && status === 'active') {
          throw new ConflictException();
        }
        try {
          assertUserStatusTransition(user.status, status);
        } catch {
          throw new ConflictException();
        }
        if (
          user.role === 'admin' &&
          user.status === 'active' &&
          status !== 'active'
        ) {
          await assertNotLastActiveAdmin(manager, user.id);
        }
        const assignment =
          status === 'deleted'
            ? `email_normalized = $2, password_hash = NULL, status = $3, role = 'user', deleted_at = CURRENT_TIMESTAMP, suspended_at = NULL`
            : `status = $2::varchar, suspended_at = CASE WHEN $2::varchar = 'suspended' THEN CURRENT_TIMESTAMP ELSE NULL END`;
        const values: readonly unknown[] =
          status === 'deleted' ? [deletedEmail(user.id), status] : [status];
        const updated = await updateUser(manager, user.id, assignment, values);
        await revokeCredentials(manager, user.id, 'STATUS_CHANGED');
        await this.audit.record(
          manager,
          auditInput('identity.status.changed', principal.user.id, user.id, {
            fromStatus: user.status,
            toStatus: status,
            self: principal.user.id === user.id,
            scope: 'all',
          }),
        );
        if (status === 'deleted') {
          await this.audit.record(
            manager,
            auditInput('identity.user.deleted', principal.user.id, user.id, {
              fromStatus: user.status,
              toStatus: status,
              self: false,
              scope: 'all',
            }),
          );
        }
        await this.outbox.enqueue(manager, {
          eventType:
            status === 'deleted'
              ? 'identity.user.delete.journaled'
              : 'identity.status.changed',
          eventVersion: 1,
          aggregateId: user.id,
          payload: { userId: user.id, status, version: updated.version },
        });
        return updated;
      },
    );
  }

  private async mutate(
    principal: AuthenticatedPrincipal,
    userId: string,
    headers: MutationHeaders,
    routeId: 'updateUserRole' | 'updateUserStatus',
    payload: Readonly<Record<string, unknown>>,
    operation: (manager: EntityManager, user: UserRow) => Promise<UserRow>,
  ): Promise<UserResponseDto> {
    const key = requiredIdempotencyKey(headers.idempotencyKey);
    const expectedVersion = requiredEtag(headers.ifMatch);
    return this.source.transaction(async (manager) => {
      const reservation = await this.reserve(
        manager,
        principal.user.id,
        key,
        routeId,
        payload,
      );
      if (typeof reservation !== 'string') {
        if ('deleteReplay' in reservation) throw new ConflictException();
        const replayed = await lockedUser(manager, reservation.userId);
        if (!replayed || replayed.version !== reservation.version) {
          throw new ConflictException();
        }
        return toUserResponse(replayed);
      }
      await lockUsers(manager, principal.user.id, userId);
      await requireRecentAuthentication(manager, principal);
      const user = await lockedUser(manager, userId);
      if (!user) throw new NotFoundException();
      assertVersion(user, expectedVersion);
      const updated = await operation(manager, user);
      const response = toUserResponse(updated);
      await this.idempotency.complete(manager, {
        recordId: reservation,
        status: 200,
        body: { userId: updated.id, version: updated.version },
        resourceVersion: updated.version,
      });
      return response;
    });
  }

  private async reserve(
    manager: EntityManager,
    actorId: string,
    key: string,
    routeId: string,
    payload: unknown,
  ): Promise<
    | string
    | { readonly deleteReplay: true }
    | { readonly userId: string; readonly version: number }
  > {
    const result = await this.idempotency.reserve(manager, {
      scopeHash: identityIdempotencyScope(
        this.authOptions.idempotencySecret,
        actorId,
      ),
      key: identityIdempotencyKey(this.authOptions.idempotencySecret, key),
      method: routeId === 'deleteCurrentUser' ? 'DELETE' : 'PATCH',
      routeId,
      payloadSha256: hashCanonicalPayload(payload),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    });
    if (result.kind === 'reserved') return result.recordId;
    if (result.kind === 'replay') {
      if (routeId === 'deleteCurrentUser' && result.status === 204)
        return { deleteReplay: true };
      if (result.status === 200 && result.body) {
        const userId = result.body.userId;
        const version = result.body.version;
        if (
          typeof userId === 'string' &&
          typeof version === 'number' &&
          Number.isSafeInteger(version) &&
          version >= 0
        ) {
          return { userId, version };
        }
      }
      throw new ConflictException();
    }
    throw new ConflictException();
  }
}

const userColumns = `id, email_normalized AS "emailNormalized", password_hash AS "passwordHash", status, role, authz_version AS "authzVersion", version, email_verified_at AS "emailVerifiedAt", suspended_at AS "suspendedAt", deleted_at AS "deletedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

async function rows<T extends object>(
  source: Pick<DataSource | EntityManager, 'query'>,
  sql: string,
  parameters: readonly unknown[],
): Promise<readonly T[]> {
  return readQueryRows<T>(await source.query(sql, [...parameters]));
}

function requiredEtag(value: string | undefined): number {
  if (!value) throw new BadRequestException('If-Match is required');
  try {
    return parseStrongEtag(value);
  } catch {
    throw new BadRequestException('Invalid If-Match');
  }
}

function requiredIdempotencyKey(value: string | undefined): string {
  if (!value) throw new BadRequestException('Idempotency-Key is required');
  try {
    return validateIdempotencyKey(value);
  } catch {
    throw new BadRequestException('Invalid Idempotency-Key');
  }
}

async function lockUser(manager: EntityManager, userId: string): Promise<void> {
  await manager.query(
    `SELECT pg_advisory_xact_lock(hashtextextended('cornerstone:auth-user:' || $1::text, 0))`,
    [userId],
  );
}

async function lockUsers(
  manager: EntityManager,
  leftUserId: string,
  rightUserId: string,
): Promise<void> {
  for (const userId of [...new Set([leftUserId, rightUserId])].sort()) {
    await lockUser(manager, userId);
  }
}

async function lockedUser(
  manager: EntityManager,
  userId: string,
): Promise<UserRow | undefined> {
  return (
    await rows<UserRow>(
      manager,
      `SELECT ${userColumns} FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    )
  )[0];
}

function assertVersion(user: UserRow, expectedVersion: number): void {
  if (user.version !== expectedVersion) throw new PreconditionFailedException();
}

async function requireRecentAuthentication(
  manager: EntityManager,
  principal: AuthenticatedPrincipal,
): Promise<void> {
  const session = (
    await rows<{ id: string }>(
      manager,
      `SELECT id FROM auth_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND last_password_auth_at >= CURRENT_TIMESTAMP - INTERVAL '10 minutes' AND idle_expires_at > CURRENT_TIMESTAMP AND absolute_expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [principal.sessionId, principal.user.id],
    )
  )[0];
  if (!session) throw new ForbiddenException();
}

async function assertNotLastActiveAdmin(
  manager: EntityManager,
  userId: string,
): Promise<void> {
  await manager.query(
    `SELECT pg_advisory_xact_lock(hashtext('cornerstone:active-admin'))`,
  );
  const count = (
    await rows<{ count: string }>(
      manager,
      `SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1`,
      [userId],
    )
  )[0];
  if (Number(count?.count ?? 0) === 0) throw new ConflictException();
}

async function updateUser(
  manager: EntityManager,
  userId: string,
  assignments: string,
  values: readonly unknown[],
): Promise<UserRow> {
  const updated = (
    await rows<UserRow>(
      manager,
      `UPDATE users SET ${assignments}, authz_version = authz_version + 1, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING ${userColumns}`,
      [userId, ...values],
    )
  )[0];
  if (!updated) throw new Error('User update was lost');
  return updated;
}

async function revokeCredentials(
  manager: EntityManager,
  userId: string,
  reason: string,
): Promise<void> {
  await manager.query(
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = $2, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
  await manager.query(
    `UPDATE auth_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = $1) AND revoked_at IS NULL`,
    [userId],
  );
  await manager.query(
    `UPDATE auth_action_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
    [userId],
  );
}

function auditInput(
  eventType:
    | 'identity.user.deleted'
    | 'identity.role.changed'
    | 'identity.status.changed',
  actorId: string,
  subjectId: string,
  metadata: Parameters<AuthAuditRepository['record']>[1]['metadata'],
) {
  const context = getRequestContext();
  const reasonCode = {
    'identity.user.deleted': 'USER_DELETED',
    'identity.role.changed': 'ROLE_CHANGED',
    'identity.status.changed': 'STATUS_CHANGED',
  }[eventType];
  return {
    eventType,
    actorId,
    subjectId,
    resourceId: subjectId,
    outcome: 'success' as const,
    reasonCode,
    requestId: context?.requestId,
    traceId: context?.traceId,
    metadata,
  };
}
