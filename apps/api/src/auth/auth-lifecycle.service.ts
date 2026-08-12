import {
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { DataSource, type EntityManager } from 'typeorm';
import type { UserResponseDto } from '../contracts/user.dto.js';
import { toUserResponse } from '../contracts/user.mapper.js';
import type { UserEntity } from '../database/entities/user.entity.js';
import { readQueryRows } from '../database/query-result.js';
import { normalizeEmail } from '../identity/identity.contract.js';
import { AccessTokenService } from './access-token.service.js';
import { PasswordWorkQueueFullError } from './auth-crypto.error.js';
import { AuthAuditRepository } from './auth-audit.repository.js';
import { AuthMailOutboxService } from './auth-mail-outbox.service.js';
import {
  AuthRateLimitService,
  authRateLimitPolicies,
  type RateLimitSubject,
} from './auth-rate-limit.service.js';
import {
  AUTH_SECURITY_OPTIONS,
  type AuthSecurityOptions,
} from './auth-security.options.js';
import {
  invalidActionToken,
  invalidCredentials,
  invalidSession,
  rateLimited,
  serviceUnavailable,
} from './auth-lifecycle.error.js';
import {
  OpaqueTokenService,
  type OpaqueTokenPurpose,
} from './opaque-token.service.js';
import { PasswordService } from './password.service.js';

export interface AuthRequestContext {
  readonly ip: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly deviceLabel?: string;
}

export interface AuthenticatedSessionResult {
  readonly user: AuthenticatedUser;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
}

export type AuthenticatedUser = UserResponseDto;

export interface AuthenticatedPrincipal {
  readonly user: AuthenticatedUser;
  readonly sessionId: string;
  readonly lastPasswordAuthAt: Date;
}

export interface SessionSummary {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly current: boolean;
}

@Injectable()
export class AuthLifecycleService implements OnModuleInit {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly source: DataSource,
    private readonly passwords: PasswordService,
    private readonly opaqueTokens: OpaqueTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly audit: AuthAuditRepository,
    private readonly mail: AuthMailOutboxService,
    @Inject(AUTH_SECURITY_OPTIONS)
    private readonly options: AuthSecurityOptions,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.getDummyHash();
  }

  async register(
    emailInput: string,
    password: string,
    context: AuthRequestContext,
  ): Promise<void> {
    const email = normalizeEmail(emailInput);
    await this.enforceRate([
      ipSubject(context.ip, authRateLimitPolicies.registerIp),
      accountSubject(email, authRateLimitPolicies.registerAccount),
    ]);
    return this.enumerationSafe(async () => {
      const passwordHash = await this.hashPassword(password);
      await this.source.transaction(async (manager) => {
        const userId = randomUUID();
        const rows = await queryRows<{ id: string }>(
          manager,
          `INSERT INTO users (
           id, email_normalized, password_hash, status, role, authz_version,
           version, email_verified_at, suspended_at, deleted_at,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, 'pending_verification', 'user', 0, 0,
           NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )
         ON CONFLICT (email_normalized) DO NOTHING
         RETURNING id`,
          [userId, email, passwordHash],
        );
        if (!rows[0]) return;
        await this.issueAction(manager, userId, email, 'verify_email');
        await this.audit.record(manager, {
          eventType: 'identity.user.registered',
          subjectId: userId,
          resourceId: userId,
          outcome: 'success',
          requestId: context.requestId,
          traceId: context.traceId,
        });
      });
    });
  }

  async resendVerification(
    emailInput: string,
    context: AuthRequestContext,
  ): Promise<void> {
    const email = normalizeEmail(emailInput);
    await this.enforceRate([
      ipSubject(context.ip, authRateLimitPolicies.verificationIp),
      accountSubject(email, authRateLimitPolicies.verificationAccount),
    ]);
    return this.enumerationSafe(async () => {
      const users = await queryRows<{ id: string }>(
        this.source,
        `SELECT id FROM users
         WHERE email_normalized = $1 AND status = 'pending_verification'`,
        [email],
      );
      const userId = users[0]?.id;
      if (!userId) return;
      await this.source.transaction(async (manager) => {
        await lockAuthUser(manager, userId);
        const users = await queryRows<{ id: string }>(
          manager,
          `SELECT id FROM users
         WHERE id = $1 AND email_normalized = $2
           AND status = 'pending_verification'
         FOR UPDATE`,
          [userId, email],
        );
        if (!users[0]) return;
        await this.issueAction(manager, users[0].id, email, 'verify_email');
      });
    });
  }

  async verifyEmail(value: string, context: AuthRequestContext): Promise<void> {
    await this.enforceRate([
      ipSubject(context.ip, authRateLimitPolicies.verificationIp),
    ]);
    const reference = this.actionReference(value);
    if (!reference) throw invalidActionToken();
    const actionUserId = await this.actionUserId(reference.recordId);
    if (!actionUserId) throw invalidActionToken();
    const success = await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, actionUserId);
      const candidate = await this.lockActionCandidate(
        manager,
        reference.recordId,
      );
      if (
        !candidate ||
        !(await this.validateActionCandidate(
          manager,
          candidate,
          'verify_email',
          value,
        ))
      ) {
        return false;
      }
      if (candidate.status !== 'pending_verification') {
        await revokeAction(manager, candidate.id);
        return false;
      }
      await manager.query(
        `UPDATE users SET status = 'active', email_verified_at = CURRENT_TIMESTAMP,
           authz_version = authz_version + 1, version = version + 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [candidate.userId],
      );
      await consumeAction(manager, candidate.id);
      await this.audit.record(manager, {
        eventType: 'identity.email.verified',
        subjectId: candidate.userId,
        resourceId: candidate.userId,
        outcome: 'success',
        requestId: context.requestId,
        traceId: context.traceId,
      });
      return true;
    });
    if (!success) throw invalidActionToken();
  }

  async requestPasswordReset(
    emailInput: string,
    context: AuthRequestContext,
  ): Promise<void> {
    const email = normalizeEmail(emailInput);
    await this.enforceRate([
      ipSubject(context.ip, authRateLimitPolicies.recoveryIp),
      accountSubject(email, authRateLimitPolicies.recoveryAccount),
    ]);
    return this.enumerationSafe(async () => {
      const users = await queryRows<{ id: string }>(
        this.source,
        `SELECT id FROM users
         WHERE email_normalized = $1 AND status = 'active'`,
        [email],
      );
      const userId = users[0]?.id;
      if (!userId) return;
      await this.source.transaction(async (manager) => {
        await lockAuthUser(manager, userId);
        const users = await queryRows<{ id: string }>(
          manager,
          `SELECT id FROM users
         WHERE id = $1 AND email_normalized = $2 AND status = 'active'
         FOR UPDATE`,
          [userId, email],
        );
        if (!users[0]) return;
        await this.issueAction(manager, users[0].id, email, 'reset_password');
      });
    });
  }

  async resetPassword(
    value: string,
    newPassword: string,
    context: AuthRequestContext,
  ): Promise<void> {
    await this.enforceRate([
      ipSubject(context.ip, authRateLimitPolicies.recoveryIp),
    ]);
    const reference = this.actionReference(value);
    if (!reference) throw invalidActionToken();
    if (
      !(await this.preflightAction(reference.recordId, 'reset_password', value))
    ) {
      await this.recordInvalidActionAttempt(
        reference.recordId,
        'reset_password',
        value,
      );
      throw invalidActionToken();
    }
    const passwordHash = await this.hashPassword(newPassword);
    const actionUserId = await this.actionUserId(reference.recordId);
    if (!actionUserId) throw invalidActionToken();
    const success = await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, actionUserId);
      const candidate = await this.lockActionCandidate(
        manager,
        reference.recordId,
      );
      if (
        !candidate ||
        !(await this.validateActionCandidate(
          manager,
          candidate,
          'reset_password',
          value,
        ))
      ) {
        return false;
      }
      if (candidate.status !== 'active') {
        await revokeAction(manager, candidate.id);
        return false;
      }
      await manager.query(
        `UPDATE users SET password_hash = $2,
           authz_version = authz_version + 1, version = version + 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [candidate.userId, passwordHash],
      );
      await revokeAllSessions(manager, candidate.userId, 'PASSWORD_RESET');
      await manager.query(
        `UPDATE auth_action_tokens SET revoked_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
           AND id <> $2`,
        [candidate.userId, candidate.id],
      );
      await consumeAction(manager, candidate.id);
      await this.audit.record(manager, {
        eventType: 'identity.password.reset',
        subjectId: candidate.userId,
        resourceId: candidate.userId,
        outcome: 'success',
        requestId: context.requestId,
        traceId: context.traceId,
        metadata: { scope: 'all' },
      });
      return true;
    });
    if (!success) throw invalidActionToken();
  }

  async login(
    emailInput: string,
    password: string,
    context: AuthRequestContext,
  ): Promise<AuthenticatedSessionResult> {
    const email = normalizeEmail(emailInput);
    await this.enforceRate([
      ipSubject(context.ip, authRateLimitPolicies.loginIp),
      accountSubject(email, authRateLimitPolicies.loginAccount),
    ]);
    const users = await queryRows<UserRecord>(
      this.source,
      `SELECT ${userColumns} FROM users u WHERE u.email_normalized = $1`,
      [email],
    );
    const userRecord = users[0];
    const user = userRecord ? candidateToUser(userRecord) : undefined;
    const passwordHash = user?.passwordHash ?? (await this.getDummyHash());
    const passwordMatches = await this.verifyPassword(passwordHash, password);
    if (
      !user ||
      !passwordMatches ||
      user.status !== 'active' ||
      user.passwordHash === null
    ) {
      await this.recordLoginFailure(user?.id, context);
      throw invalidCredentials();
    }

    const replacementHash = this.passwords.needsRehash(user.passwordHash)
      ? await this.hashPassword(password)
      : undefined;
    const session = await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, user.id);
      const lockedUsers = await queryRows<UserRecord>(
        manager,
        `SELECT ${userColumns} FROM users u WHERE u.id = $1 FOR UPDATE`,
        [user.id],
      );
      const lockedRecord = lockedUsers[0];
      if (
        !lockedRecord ||
        lockedRecord.status !== 'active' ||
        lockedRecord.passwordHash !== user.passwordHash
      ) {
        return undefined;
      }
      const locked = candidateToUser(lockedRecord);
      if (replacementHash) {
        await manager.query(
          `UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [locked.id, replacementHash],
        );
        locked.passwordHash = replacementHash;
      }
      const session = await this.createSession(manager, locked, context);
      await this.audit.record(manager, {
        eventType: 'identity.login.succeeded',
        actorId: locked.id,
        subjectId: locked.id,
        resourceId: session.sessionId,
        outcome: 'success',
        requestId: context.requestId,
        traceId: context.traceId,
        metadata: { factor: 'password' },
      });
      return session;
    });
    if (!session) {
      await this.recordLoginFailure(user.id, context);
      throw invalidCredentials();
    }
    return session;
  }

  async refresh(
    refreshValue: string,
    context: AuthRequestContext,
  ): Promise<AuthenticatedSessionResult> {
    let tokenHash: string;
    let keyVersion: string;
    try {
      ({ hash: tokenHash, keyVersion } = this.opaqueTokens.hash(
        'refresh',
        refreshValue,
      ));
    } catch {
      await this.recordRefreshFailure(undefined, context, 'INVALID_TOKEN');
      throw invalidSession();
    }
    const sessions = await queryRows<{ sessionId: string; userId: string }>(
      this.source,
      `SELECT token.session_id AS "sessionId", session.user_id AS "userId"
       FROM auth_refresh_tokens token
       JOIN auth_sessions session ON session.id = token.session_id
       WHERE token.token_hash = $1 AND token.key_version = $2`,
      [tokenHash, keyVersion],
    );
    const sessionId = sessions[0]?.sessionId;
    const userId = sessions[0]?.userId;
    if (!sessionId || !userId) {
      await this.recordRefreshFailure(undefined, context, 'INVALID_TOKEN');
      throw invalidSession();
    }
    await this.enforceRate([
      sessionSubject(sessionId, authRateLimitPolicies.refreshSession),
    ]);

    const result = await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, userId);
      const candidates = await queryRows<RefreshCandidate>(
        manager,
        `SELECT t.id, t.session_id AS "sessionId", t.generation,
           t.token_hash AS "tokenHash", t.key_version AS "keyVersion",
           t.expires_at AS "tokenExpiresAt", t.consumed_at AS "consumedAt",
           t.revoked_at AS "tokenRevokedAt",
           s.current_generation AS "currentGeneration",
           s.idle_expires_at AS "idleExpiresAt",
           s.absolute_expires_at AS "absoluteExpiresAt",
           s.revoked_at AS "sessionRevokedAt",
           ${userColumns}
         FROM auth_refresh_tokens t
         JOIN auth_sessions s ON s.id = t.session_id
         JOIN users u ON u.id = s.user_id
         WHERE t.token_hash = $1 AND t.key_version = $2
         FOR UPDATE OF t, s, u`,
        [tokenHash, keyVersion],
      );
      const candidate = candidates[0];
      if (!candidate) return { kind: 'invalid' as const };
      if (candidate.consumedAt) {
        await revokeSession(manager, candidate.sessionId, 'REFRESH_REUSE');
        await this.audit.record(manager, {
          eventType: 'identity.refresh.reused',
          subjectId: candidate.userId,
          resourceId: candidate.sessionId,
          outcome: 'denied',
          reasonCode: 'REFRESH_REUSE',
          requestId: context.requestId,
          traceId: context.traceId,
          metadata: { familyRevoked: true },
        });
        return { kind: 'reuse' as const };
      }
      if (candidate.tokenRevokedAt) return { kind: 'invalid' as const };
      const now = new Date();
      if (
        !this.opaqueTokens.matches(
          'refresh',
          refreshValue,
          candidate.tokenHash,
          candidate.keyVersion,
        ) ||
        candidate.generation !== candidate.currentGeneration ||
        candidate.tokenExpiresAt <= now ||
        candidate.idleExpiresAt <= now ||
        candidate.absoluteExpiresAt <= now ||
        candidate.sessionRevokedAt ||
        candidate.status !== 'active'
      ) {
        await revokeSession(manager, candidate.sessionId, 'SESSION_INVALID');
        return { kind: 'invalid' as const };
      }
      const next = this.opaqueTokens.issue('refresh');
      const nextGeneration = candidate.generation + 1;
      const nextIdleExpiry = minimumDate(
        new Date(
          now.getTime() + this.options.refreshToken.idleTtlSeconds * 1000,
        ),
        candidate.absoluteExpiresAt,
      );
      await manager.query(
        `UPDATE auth_refresh_tokens SET consumed_at = $2
         WHERE id = $1 AND consumed_at IS NULL`,
        [candidate.id, now],
      );
      await manager.query(
        `UPDATE auth_sessions SET current_generation = $2,
           last_seen_at = $3, idle_expires_at = $4,
           version = version + 1, updated_at = $3
         WHERE id = $1`,
        [candidate.sessionId, nextGeneration, now, nextIdleExpiry],
      );
      await insertRefreshToken(
        manager,
        candidate.sessionId,
        nextGeneration,
        next,
        nextIdleExpiry,
        now,
      );
      const user = candidateToUser(candidate);
      const accessToken = await this.accessTokens.issue({
        userId: user.id,
        sessionId: candidate.sessionId,
        authzVersion: user.authzVersion,
      });
      return {
        kind: 'success' as const,
        session: {
          user: toAuthenticatedUser(user),
          accessToken,
          refreshToken: next.value,
          sessionId: candidate.sessionId,
          accessExpiresAt: new Date(
            now.getTime() + this.options.accessToken.ttlSeconds * 1000,
          ),
          refreshExpiresAt: nextIdleExpiry,
        },
      };
    });
    if (result.kind === 'invalid') {
      await this.recordRefreshFailure(sessionId, context, 'INVALID_SESSION');
      throw invalidSession();
    }
    if (result.kind === 'reuse') throw invalidSession();
    return result.session;
  }

  async authorizeRefresh(
    value: string,
    ip: string,
  ): Promise<string | undefined> {
    await this.enforceRate([ipSubject(ip, authRateLimitPolicies.refreshIp)]);
    let token: { readonly hash: string; readonly keyVersion: string };
    try {
      token = this.opaqueTokens.hash('refresh', value);
    } catch {
      return undefined;
    }
    const rows = await queryRows<{ sessionId: string }>(
      this.source,
      `SELECT session_id AS "sessionId" FROM auth_refresh_tokens
       WHERE token_hash = $1 AND key_version = $2`,
      [token.hash, token.keyVersion],
    );
    return rows[0]?.sessionId;
  }

  async authenticateAccess(value: string): Promise<AuthenticatedPrincipal> {
    let token: Awaited<ReturnType<AccessTokenService['verify']>>;
    try {
      token = await this.accessTokens.verify(value);
    } catch {
      throw invalidSession();
    }
    const rows = await queryRows<
      UserRecord & {
        readonly sessionId: string;
        readonly lastPasswordAuthAt: Date;
      }
    >(
      this.source,
      `SELECT ${userColumns}, s.id AS "sessionId",
         s.last_password_auth_at AS "lastPasswordAuthAt"
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND u.id = $2 AND u.authz_version = $3
         AND u.status = 'active' AND s.revoked_at IS NULL
         AND s.idle_expires_at > CURRENT_TIMESTAMP
         AND s.absolute_expires_at > CURRENT_TIMESTAMP`,
      [token.sessionId, token.userId, token.authzVersion],
    );
    const row = rows[0];
    if (!row) throw invalidSession();
    return {
      user: toAuthenticatedUser(candidateToUser(row)),
      sessionId: row.sessionId,
      lastPasswordAuthAt: row.lastPasswordAuthAt,
    };
  }

  async logout(
    principal: AuthenticatedPrincipal,
    context: AuthRequestContext,
  ): Promise<void> {
    await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, principal.user.id);
      const rows = await queryRows<{ id: string }>(
        manager,
        `SELECT id FROM auth_sessions
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
           AND idle_expires_at > CURRENT_TIMESTAMP
           AND absolute_expires_at > CURRENT_TIMESTAMP
         FOR UPDATE`,
        [principal.sessionId, principal.user.id],
      );
      if (!rows[0]) throw invalidSession();
      await revokeSession(manager, principal.sessionId, 'LOGOUT');
      await this.audit.record(manager, {
        eventType: 'identity.logout.succeeded',
        actorId: principal.user.id,
        subjectId: principal.user.id,
        resourceId: principal.sessionId,
        outcome: 'success',
        requestId: context.requestId,
        traceId: context.traceId,
        metadata: { scope: 'current' },
      });
    });
  }

  async changePassword(
    principal: AuthenticatedPrincipal,
    currentPassword: string,
    newPassword: string,
    context: AuthRequestContext,
  ): Promise<void> {
    await this.enforceRate([
      sessionSubject(
        principal.sessionId,
        authRateLimitPolicies.sessionMutation,
      ),
    ]);
    const candidates = await queryRows<UserRecord>(
      this.source,
      `SELECT ${userColumns} FROM users u WHERE u.id = $1`,
      [principal.user.id],
    );
    const candidate = candidates[0];
    if (
      !candidate ||
      candidate.status !== 'active' ||
      candidate.passwordHash === null ||
      !(await this.verifyPassword(candidate.passwordHash, currentPassword))
    ) {
      throw invalidCredentials();
    }
    const newPasswordHash = await this.hashPassword(newPassword);
    const changed = await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, principal.user.id);
      const rows = await queryRows<UserRecord>(
        manager,
        `SELECT ${userColumns} FROM users u WHERE u.id = $1 FOR UPDATE`,
        [principal.user.id],
      );
      const user = rows[0];
      if (
        !user ||
        user.status !== 'active' ||
        user.passwordHash !== candidate.passwordHash
      ) {
        return false;
      }
      const sessions = await queryRows<{ id: string }>(
        manager,
        `SELECT id FROM auth_sessions
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
           AND idle_expires_at > CURRENT_TIMESTAMP
           AND absolute_expires_at > CURRENT_TIMESTAMP
         FOR UPDATE`,
        [principal.sessionId, user.userId],
      );
      if (!sessions[0]) return false;
      await manager.query(
        `UPDATE users SET password_hash = $2,
           authz_version = authz_version + 1, version = version + 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [user.userId, newPasswordHash],
      );
      await revokeAllSessions(manager, user.userId, 'PASSWORD_CHANGE');
      await this.audit.record(manager, {
        eventType: 'identity.password.changed',
        actorId: user.userId,
        subjectId: user.userId,
        resourceId: principal.sessionId,
        outcome: 'success',
        requestId: context.requestId,
        traceId: context.traceId,
        metadata: { factor: 'password', scope: 'all' },
      });
      return true;
    });
    if (!changed) throw invalidCredentials();
  }

  async confirmRecentAuthentication(
    principal: AuthenticatedPrincipal,
    password: string,
    context: AuthRequestContext,
  ): Promise<void> {
    await this.enforceRate([
      sessionSubject(
        principal.sessionId,
        authRateLimitPolicies.sessionMutation,
      ),
    ]);
    const candidates = await queryRows<UserRecord>(
      this.source,
      `SELECT ${userColumns} FROM users u WHERE u.id = $1`,
      [principal.user.id],
    );
    const candidate = candidates[0];
    if (
      !candidate ||
      candidate.status !== 'active' ||
      candidate.passwordHash === null ||
      !(await this.verifyPassword(candidate.passwordHash, password))
    ) {
      throw invalidCredentials();
    }
    const confirmed = await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, principal.user.id);
      const rows = await queryRows<UserRecord>(
        manager,
        `SELECT ${userColumns} FROM users u WHERE u.id = $1 FOR UPDATE`,
        [principal.user.id],
      );
      const user = rows[0];
      if (
        !user ||
        user.status !== 'active' ||
        user.passwordHash !== candidate.passwordHash
      ) {
        return false;
      }
      const updated = await queryRows<{ id: string }>(
        manager,
        `UPDATE auth_sessions SET last_password_auth_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
           AND idle_expires_at > CURRENT_TIMESTAMP
           AND absolute_expires_at > CURRENT_TIMESTAMP
         RETURNING id`,
        [principal.sessionId, user.userId],
      );
      if (updated.length !== 1) return false;
      await this.audit.record(manager, {
        eventType: 'identity.recent_auth.confirmed',
        actorId: user.userId,
        subjectId: user.userId,
        resourceId: principal.sessionId,
        outcome: 'success',
        requestId: context.requestId,
        traceId: context.traceId,
        metadata: { factor: 'password', scope: 'current' },
      });
      return true;
    });
    if (!confirmed) throw invalidCredentials();
  }

  async listSessions(
    principal: AuthenticatedPrincipal,
  ): Promise<readonly SessionSummary[]> {
    return queryRows<SessionSummary>(
      this.source,
      `SELECT id, device_label AS "deviceLabel", last_seen_at AS "lastSeenAt",
         idle_expires_at AS "idleExpiresAt",
         absolute_expires_at AS "absoluteExpiresAt",
         id = $2 AS current
       FROM auth_sessions
       WHERE user_id = $1 AND revoked_at IS NULL
         AND idle_expires_at > CURRENT_TIMESTAMP
         AND absolute_expires_at > CURRENT_TIMESTAMP
       ORDER BY (id = $2) DESC, last_seen_at DESC, id ASC`,
      [principal.user.id, principal.sessionId],
    );
  }

  async revokeSession(
    principal: AuthenticatedPrincipal,
    targetSessionId: string,
    context: AuthRequestContext,
  ): Promise<void> {
    await this.enforceRate([
      sessionSubject(
        principal.sessionId,
        authRateLimitPolicies.sessionMutation,
      ),
    ]);
    await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, principal.user.id);
      const actors = await queryRows<{ id: string }>(
        manager,
        `SELECT id FROM auth_sessions
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
           AND idle_expires_at > CURRENT_TIMESTAMP
           AND absolute_expires_at > CURRENT_TIMESTAMP
         FOR UPDATE`,
        [principal.sessionId, principal.user.id],
      );
      if (!actors[0]) throw invalidSession();
      const sessions = await queryRows<{ id: string }>(
        manager,
        `SELECT id FROM auth_sessions
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
           AND idle_expires_at > CURRENT_TIMESTAMP
           AND absolute_expires_at > CURRENT_TIMESTAMP
         FOR UPDATE`,
        [targetSessionId, principal.user.id],
      );
      if (!sessions[0]) throw new NotFoundException();
      await revokeSession(manager, targetSessionId, 'SESSION_REVOKED');
      await this.audit.record(manager, {
        eventType: 'identity.session.revoked',
        actorId: principal.user.id,
        subjectId: principal.user.id,
        resourceId: targetSessionId,
        outcome: 'success',
        requestId: context.requestId,
        traceId: context.traceId,
        metadata: {
          scope: 'target',
          self: targetSessionId === principal.sessionId,
        },
      });
    });
  }

  async revokeAllSessions(
    principal: AuthenticatedPrincipal,
    context: AuthRequestContext,
  ): Promise<void> {
    await this.enforceRate([
      sessionSubject(
        principal.sessionId,
        authRateLimitPolicies.sessionMutation,
      ),
    ]);
    const revoked = await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, principal.user.id);
      const users = await queryRows<{ id: string }>(
        manager,
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [principal.user.id],
      );
      if (!users[0]) return false;
      const sessions = await queryRows<{ id: string }>(
        manager,
        `SELECT id
         FROM auth_sessions
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
           AND idle_expires_at > CURRENT_TIMESTAMP
           AND absolute_expires_at > CURRENT_TIMESTAMP
           AND last_password_auth_at >= CURRENT_TIMESTAMP - INTERVAL '10 minutes'
         FOR UPDATE`,
        [principal.sessionId, principal.user.id],
      );
      if (!sessions[0]) return false;
      const updatedUsers = await queryRows<{ id: string }>(
        manager,
        `UPDATE users SET authz_version = authz_version + 1,
           version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id`,
        [principal.user.id],
      );
      if (updatedUsers.length !== 1) return false;
      const sessionCount = await revokeAllSessions(
        manager,
        principal.user.id,
        'REVOKE_ALL',
      );
      await this.audit.record(manager, {
        eventType: 'identity.session.revoked',
        actorId: principal.user.id,
        subjectId: principal.user.id,
        resourceId: principal.sessionId,
        outcome: 'success',
        requestId: context.requestId,
        traceId: context.traceId,
        metadata: { scope: 'all', sessionCount },
      });
      return true;
    });
    if (!revoked) throw invalidSession();
  }

  private async createSession(
    manager: EntityManager,
    user: UserEntity,
    context: AuthRequestContext,
  ): Promise<AuthenticatedSessionResult> {
    const now = new Date();
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const idleExpiresAt = new Date(
      now.getTime() + this.options.refreshToken.idleTtlSeconds * 1000,
    );
    const absoluteExpiresAt = new Date(
      now.getTime() + this.options.refreshToken.absoluteTtlSeconds * 1000,
    );
    await manager.query(
      `INSERT INTO auth_sessions (
         id, family_id, user_id, current_generation, device_label,
         last_password_auth_at, last_seen_at, idle_expires_at,
         absolute_expires_at, revoked_at, revoke_reason, version,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 0, $4, $5, $5, $6, $7, NULL, NULL, 0, $5, $5)`,
      [
        sessionId,
        familyId,
        user.id,
        normalizeDeviceLabel(context.deviceLabel),
        now,
        idleExpiresAt,
        absoluteExpiresAt,
      ],
    );
    const refresh = this.opaqueTokens.issue('refresh');
    await insertRefreshToken(
      manager,
      sessionId,
      0,
      refresh,
      idleExpiresAt,
      now,
    );
    const accessToken = await this.accessTokens.issue({
      userId: user.id,
      sessionId,
      authzVersion: user.authzVersion,
    });
    return {
      user: toAuthenticatedUser(user),
      accessToken,
      refreshToken: refresh.value,
      sessionId,
      accessExpiresAt: new Date(
        now.getTime() + this.options.accessToken.ttlSeconds * 1000,
      ),
      refreshExpiresAt: idleExpiresAt,
    };
  }

  private async issueAction(
    manager: EntityManager,
    userId: string,
    recipient: string,
    purpose: Exclude<OpaqueTokenPurpose, 'refresh'>,
  ): Promise<void> {
    await manager.query(
      `UPDATE auth_action_tokens SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND purpose = $2
         AND consumed_at IS NULL AND revoked_at IS NULL`,
      [userId, purpose],
    );
    const id = randomUUID();
    const token = this.opaqueTokens.issue(purpose, id);
    const ttlMs = purpose === 'verify_email' ? 24 * 60 * 60_000 : 30 * 60_000;
    await manager.query(
      `INSERT INTO auth_action_tokens (
         id, user_id, purpose, token_hash, key_version, attempt_count,
         max_attempts, expires_at, consumed_at, revoked_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, 0, 5, $6, NULL, NULL, CURRENT_TIMESTAMP)`,
      [
        id,
        userId,
        purpose,
        token.hash,
        token.keyVersion,
        new Date(Date.now() + ttlMs),
      ],
    );
    await this.mail.enqueue(manager, {
      userId,
      purpose,
      recipient,
      actionValue: token.value,
    });
  }

  private actionReference(
    value: string,
  ): { readonly recordId: string } | undefined {
    try {
      return this.opaqueTokens.actionReference(value);
    } catch {
      return undefined;
    }
  }

  private async lockActionCandidate(
    manager: EntityManager,
    recordId: string,
  ): Promise<ActionCandidate | undefined> {
    const rows = await queryRows<ActionCandidate>(
      manager,
      `SELECT t.id, t.purpose, t.token_hash AS "tokenHash",
         t.key_version AS "keyVersion", t.attempt_count AS "attemptCount",
         t.max_attempts AS "maxAttempts", t.expires_at AS "expiresAt",
         t.consumed_at AS "consumedAt", t.revoked_at AS "revokedAt",
         ${userColumns}
       FROM auth_action_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.id = $1 FOR UPDATE OF t, u`,
      [recordId],
    );
    return rows[0];
  }

  private async actionUserId(recordId: string): Promise<string | undefined> {
    const rows = await queryRows<{ userId: string }>(
      this.source,
      `SELECT user_id AS "userId" FROM auth_action_tokens WHERE id = $1`,
      [recordId],
    );
    return rows[0]?.userId;
  }

  private async preflightAction(
    recordId: string,
    purpose: Exclude<OpaqueTokenPurpose, 'refresh'>,
    value: string,
  ): Promise<boolean> {
    const rows = await queryRows<ActionCandidate>(
      this.source,
      `SELECT t.id, t.purpose, t.token_hash AS "tokenHash",
         t.key_version AS "keyVersion", t.attempt_count AS "attemptCount",
         t.max_attempts AS "maxAttempts", t.expires_at AS "expiresAt",
         t.consumed_at AS "consumedAt", t.revoked_at AS "revokedAt",
         ${userColumns}
       FROM auth_action_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.id = $1`,
      [recordId],
    );
    const candidate = rows[0];
    const now = new Date();
    return Boolean(
      candidate &&
      !candidate.consumedAt &&
      !candidate.revokedAt &&
      candidate.expiresAt > now &&
      candidate.attemptCount < candidate.maxAttempts &&
      candidate.status === 'active' &&
      candidate.purpose === purpose &&
      this.opaqueTokens.matches(
        purpose,
        value,
        candidate.tokenHash,
        candidate.keyVersion,
      ),
    );
  }

  private async recordInvalidActionAttempt(
    recordId: string,
    purpose: Exclude<OpaqueTokenPurpose, 'refresh'>,
    value: string,
  ): Promise<void> {
    const userId = await this.actionUserId(recordId);
    if (!userId) return;
    await this.source.transaction(async (manager) => {
      await lockAuthUser(manager, userId);
      const candidate = await this.lockActionCandidate(manager, recordId);
      if (!candidate) return;
      const valid = await this.validateActionCandidate(
        manager,
        candidate,
        purpose,
        value,
      );
      if (valid && candidate.status !== 'active') {
        await revokeAction(manager, candidate.id);
      }
    });
  }

  private async validateActionCandidate(
    manager: EntityManager,
    candidate: ActionCandidate,
    purpose: Exclude<OpaqueTokenPurpose, 'refresh'>,
    value: string,
  ): Promise<boolean> {
    const now = new Date();
    if (
      candidate.consumedAt ||
      candidate.revokedAt ||
      candidate.expiresAt <= now ||
      candidate.attemptCount >= candidate.maxAttempts
    ) {
      if (!candidate.consumedAt && !candidate.revokedAt) {
        await manager.query(
          'UPDATE auth_action_tokens SET revoked_at = $2 WHERE id = $1',
          [candidate.id, now],
        );
      }
      return false;
    }
    if (
      candidate.purpose !== purpose ||
      !this.opaqueTokens.matches(
        purpose,
        value,
        candidate.tokenHash,
        candidate.keyVersion,
      )
    ) {
      await manager.query(
        `UPDATE auth_action_tokens
         SET attempt_count = LEAST(attempt_count + 1, max_attempts),
           revoked_at = CASE
             WHEN attempt_count + 1 >= max_attempts THEN $2 ELSE revoked_at
           END
         WHERE id = $1`,
        [candidate.id, now],
      );
      return false;
    }
    return true;
  }

  private async enforceRate(
    subjects: readonly RateLimitSubject[],
  ): Promise<void> {
    let decision: Awaited<ReturnType<AuthRateLimitService['consume']>>;
    try {
      decision = await this.rateLimits.consume(subjects);
    } catch {
      throw serviceUnavailable();
    }
    if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
  }

  private async enumerationSafe(operation: () => Promise<void>): Promise<void> {
    const deadline = performance.now() + 300 + randomInt(0, 51);
    try {
      await operation();
    } finally {
      const remainingMs = deadline - performance.now();
      if (remainingMs > 0) await delay(remainingMs);
    }
  }

  private async hashPassword(password: string): Promise<string> {
    try {
      return await this.passwords.hash(password);
    } catch (error) {
      if (error instanceof PasswordWorkQueueFullError) {
        throw serviceUnavailable();
      }
      throw error;
    }
  }

  private async verifyPassword(
    hash: string,
    password: string,
  ): Promise<boolean> {
    try {
      return await this.passwords.verify(hash, password);
    } catch (error) {
      if (error instanceof PasswordWorkQueueFullError) {
        throw serviceUnavailable();
      }
      throw error;
    }
  }

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hashPassword(
      randomBytes(32).toString('base64url'),
    ).catch((error: unknown) => {
      this.dummyHash = undefined;
      throw error;
    });
    return this.dummyHash;
  }

  private async recordLoginFailure(
    subjectId: string | undefined,
    context: AuthRequestContext,
  ): Promise<void> {
    await this.source.transaction((manager) =>
      this.audit.record(manager, {
        eventType: 'identity.login.failed',
        ...(subjectId ? { subjectId } : {}),
        outcome: 'denied',
        reasonCode: 'INVALID_CREDENTIALS',
        requestId: context.requestId,
        traceId: context.traceId,
        metadata: { factor: 'password' },
      }),
    );
  }

  private async recordRefreshFailure(
    sessionId: string | undefined,
    context: AuthRequestContext,
    reasonCode: string,
  ): Promise<void> {
    await this.source.transaction((manager) =>
      this.audit.record(manager, {
        eventType: 'identity.refresh.failed',
        ...(sessionId ? { resourceId: sessionId } : {}),
        outcome: 'denied',
        reasonCode,
        requestId: context.requestId,
        traceId: context.traceId,
      }),
    );
  }
}

interface ActionCandidate extends UserRecord {
  readonly id: string;
  readonly purpose: Exclude<OpaqueTokenPurpose, 'refresh'>;
  readonly tokenHash: string;
  readonly keyVersion: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
}

interface UserRecord {
  readonly userId: string;
  readonly emailNormalized: string;
  readonly passwordHash: string | null;
  readonly status: UserEntity['status'];
  readonly role: UserEntity['role'];
  readonly authzVersion: number;
  readonly version: number;
  readonly emailVerifiedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface RefreshCandidate extends UserRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly tokenHash: string;
  readonly keyVersion: string;
  readonly tokenExpiresAt: Date;
  readonly consumedAt: Date | null;
  readonly tokenRevokedAt: Date | null;
  readonly currentGeneration: number;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly sessionRevokedAt: Date | null;
}

const userColumns = `u.id AS "userId", u.email_normalized AS "emailNormalized",
  u.password_hash AS "passwordHash", u.status, u.role,
  u.authz_version AS "authzVersion", u.version,
  u.email_verified_at AS "emailVerifiedAt", u.suspended_at AS "suspendedAt",
  u.deleted_at AS "deletedAt", u.created_at AS "createdAt",
  u.updated_at AS "updatedAt"`;

function candidateToUser(candidate: UserRecord): UserEntity {
  return {
    id: candidate.userId,
    emailNormalized: candidate.emailNormalized,
    passwordHash: candidate.passwordHash,
    status: candidate.status,
    role: candidate.role,
    authzVersion: candidate.authzVersion,
    version: candidate.version,
    emailVerifiedAt: candidate.emailVerifiedAt,
    suspendedAt: candidate.suspendedAt,
    deletedAt: candidate.deletedAt,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function toAuthenticatedUser(user: UserEntity): AuthenticatedUser {
  return toUserResponse(user);
}

async function queryRows<T extends object>(
  source: Pick<DataSource | EntityManager, 'query'>,
  sql: string,
  parameters: readonly unknown[],
): Promise<readonly T[]> {
  return readQueryRows<T>(await source.query(sql, [...parameters]));
}

async function insertRefreshToken(
  manager: EntityManager,
  sessionId: string,
  generation: number,
  token: { readonly hash: string; readonly keyVersion: string },
  expiresAt: Date,
  createdAt: Date,
): Promise<void> {
  await manager.query(
    `INSERT INTO auth_refresh_tokens (
       id, session_id, generation, token_hash, key_version, expires_at,
       consumed_at, revoked_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7)`,
    [
      randomUUID(),
      sessionId,
      generation,
      token.hash,
      token.keyVersion,
      expiresAt,
      createdAt,
    ],
  );
}

async function consumeAction(
  manager: EntityManager,
  actionId: string,
): Promise<void> {
  await manager.query(
    `UPDATE auth_action_tokens SET consumed_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
    [actionId],
  );
}

async function revokeAction(
  manager: EntityManager,
  actionId: string,
): Promise<void> {
  await manager.query(
    `UPDATE auth_action_tokens SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
    [actionId],
  );
}

async function revokeAllSessions(
  manager: EntityManager,
  userId: string,
  reason: string,
): Promise<number> {
  const sessions = await queryRows<{ id: string }>(
    manager,
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP,
       revoke_reason = $2, version = version + 1,
       updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [userId, reason],
  );
  await manager.query(
    `UPDATE auth_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
     WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = $1)
       AND revoked_at IS NULL`,
    [userId],
  );
  return sessions.length;
}

async function lockAuthUser(
  manager: EntityManager,
  userId: string,
): Promise<void> {
  await manager.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('cornerstone:auth-user:' || $1::text, 0)
     )`,
    [userId],
  );
}

async function revokeSession(
  manager: EntityManager,
  sessionId: string,
  reason: string,
): Promise<void> {
  await manager.query(
    `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
       revoke_reason = COALESCE(revoke_reason, $2),
       version = version + CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END,
       updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [sessionId, reason],
  );
  await manager.query(
    `UPDATE auth_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
     WHERE session_id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}

function minimumDate(left: Date, right: Date): Date {
  return left <= right ? left : right;
}

function normalizeDeviceLabel(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  return [...normalized].slice(0, 120).join('');
}

function ipSubject(
  value: string,
  policy: RateLimitSubject['policy'],
): RateLimitSubject {
  return { kind: 'ip', value, policy };
}

function accountSubject(
  value: string,
  policy: RateLimitSubject['policy'],
): RateLimitSubject {
  return { kind: 'account', value, policy };
}

function sessionSubject(
  value: string,
  policy: RateLimitSubject['policy'],
): RateLimitSubject {
  return { kind: 'session', value, policy };
}
