import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { AccessTokenService } from '../src/auth/access-token.service.js';
import {
  AuthAuditRepository,
  type AuthAuditMetadata,
} from '../src/auth/auth-audit.repository.js';
import { AuthLifecycleService } from '../src/auth/auth-lifecycle.service.js';
import { AuthMailOutboxService } from '../src/auth/auth-mail-outbox.service.js';
import {
  AuthRateLimitService,
  authRateLimitPolicies,
} from '../src/auth/auth-rate-limit.service.js';
import type { AuthSecurityOptions } from '../src/auth/auth-security.options.js';
import {
  MailOutboxEnvelopeService,
  type AuthMailPurpose,
  type SealedMailEnvelope,
} from '../src/auth/mail-outbox-envelope.service.js';
import { OpaqueTokenService } from '../src/auth/opaque-token.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configuration } from '../src/config/configuration.js';
import { validateDatabaseEnvironment } from '../src/config/env.schema.js';
import { buildDatabaseOptions } from '../src/database/database-options.js';
import { IdempotencyRepository } from '../src/database/idempotency.repository.js';
import { OutboxRepository } from '../src/database/outbox.repository.js';
import { readQueryRows } from '../src/database/query-result.js';
import {
  OutboxWorker,
  TypeOrmOutboxWorkStore,
} from '../src/database/outbox.worker.js';
import { cleanupExpiredOperationalData } from '../src/database/retention-cleanup.js';
import { bootstrapInitialAdmin } from '../src/database/admin-bootstrap/admin-bootstrap.service.js';
import { validateAdminBootstrapEnvironment } from '../src/database/admin-bootstrap/admin-bootstrap-environment.js';
import { buildAdminBootstrapDatabaseOptions } from '../src/database/admin-bootstrap/admin-bootstrap-database-options.js';
import { UsersService } from '../src/users/users.service.js';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('Database repositories (integration)', () => {
  let source: DataSource;
  let replicaSource: DataSource;
  let migrationSource: DataSource;
  let maintenanceSource: DataSource;

  beforeAll(async () => {
    const runtimeEnvironment = { ...process.env };
    delete runtimeEnvironment.DATABASE_ADMIN_BOOTSTRAP_URL;
    delete runtimeEnvironment.ADMIN_BOOTSTRAP_EMAIL;
    delete runtimeEnvironment.ADMIN_BOOTSTRAP_PASSWORD_FILE;
    delete runtimeEnvironment.ADMIN_BOOTSTRAP_REQUEST_ID;
    const databaseEnvironment = validateDatabaseEnvironment(runtimeEnvironment);
    source = new DataSource(
      buildDatabaseOptions(databaseEnvironment, 'runtime'),
    );
    await source.initialize();
    replicaSource = new DataSource(
      buildDatabaseOptions(databaseEnvironment, 'runtime'),
    );
    await replicaSource.initialize();
    migrationSource = new DataSource(
      buildDatabaseOptions(databaseEnvironment, 'migration'),
    );
    await migrationSource.initialize();
    maintenanceSource = new DataSource(
      buildDatabaseOptions(databaseEnvironment, 'maintenance'),
    );
    await maintenanceSource.initialize();
  });

  beforeEach(async () => {
    await migrationSource.query(`
      TRUNCATE TABLE admin_bootstrap_markers, audit_events, outbox_events, idempotency_records,
        rate_limit_buckets, auth_refresh_tokens, auth_action_tokens,
        auth_sessions, users
    `);
  });

  it('shares atomic rate limits without storing the raw subject', async () => {
    const primary = new AuthRateLimitService(source, authSecurityOptions());
    const replica = new AuthRateLimitService(
      replicaSource,
      authSecurityOptions(),
    );
    const decisions = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        (index % 2 === 0 ? primary : replica).consume([
          {
            kind: 'ip',
            value: '203.0.113.10',
            policy: authRateLimitPolicies.registerIp,
          },
        ]),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(20);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(5);
    const rows: unknown = await source.query(
      `SELECT subject_hash AS "subjectHash", count
       FROM rate_limit_buckets WHERE policy_id = $1`,
      [authRateLimitPolicies.registerIp.id],
    );
    expect(rows).toEqual([expect.objectContaining({ count: 21 })]);
    expect(JSON.stringify(rows)).not.toContain('203.0.113.10');
  });

  it('orders compound limit locks and bounds account cardinality after IP denial', async () => {
    const service = new AuthRateLimitService(source, authSecurityOptions());
    const ip = '198.51.100.40';
    const subjects = (email: string) => [
      {
        kind: 'account' as const,
        value: email,
        policy: authRateLimitPolicies.registerAccount,
      },
      {
        kind: 'ip' as const,
        value: ip,
        policy: authRateLimitPolicies.registerIp,
      },
    ];
    await expect(
      service.consume([subjects('account-only@example.test')[0]!]),
    ).rejects.toThrow('requires an IP or session');
    await expect(
      Promise.all([
        service.consume(subjects('order-one@example.test')),
        service.consume([...subjects('order-one@example.test')].reverse()),
      ]),
    ).resolves.toHaveLength(2);

    for (let index = 0; index < 40; index += 1) {
      await service.consume(subjects(`cardinality-${index}@example.test`));
    }
    const rows: unknown = await source.query(
      `SELECT policy_id AS "policyId", count(*)::integer AS count
       FROM rate_limit_buckets
       WHERE policy_id IN ($1, $2)
       GROUP BY policy_id ORDER BY policy_id`,
      [
        authRateLimitPolicies.registerAccount.id,
        authRateLimitPolicies.registerIp.id,
      ],
    );
    expect(rows).toEqual([
      { policyId: authRateLimitPolicies.registerAccount.id, count: 19 },
      { policyId: authRateLimitPolicies.registerIp.id, count: 1 },
    ]);
  });

  it('stores mail action values only inside an authenticated envelope', async () => {
    const options = authSecurityOptions();
    const envelopes = new MailOutboxEnvelopeService(options);
    const service = new AuthMailOutboxService(
      new OutboxRepository(),
      envelopes,
    );
    const userId = randomUUID();
    const recipient = 'outbox-person@example.test';
    const actionValue = `mail-v2.${'a'.repeat(43)}`;
    await source.transaction((manager) =>
      service.enqueue(manager, {
        userId,
        purpose: 'verify_email',
        recipient,
        actionValue,
      }),
    );

    const rows: unknown = await source.query(
      `SELECT payload FROM outbox_events
       WHERE aggregate_id = $1 AND event_type = 'identity.mail.verification.requested'`,
      [userId],
    );
    expect(Array.isArray(rows)).toBe(true);
    const payload = Reflect.get((rows as object[])[0]!, 'payload') as {
      sealed: Parameters<MailOutboxEnvelopeService['open']>[0];
    };
    expect(JSON.stringify(payload)).not.toContain(recipient);
    expect(JSON.stringify(payload)).not.toContain(actionValue);
    expect(
      envelopes.open(payload.sealed, {
        userId,
        purpose: 'verify_email',
        eventType: 'identity.mail.verification.requested',
        eventVersion: 1,
      }),
    ).toEqual({ purpose: 'verify_email', recipient, actionValue });
  });

  it('writes append-only auth audit events without sensitive metadata', async () => {
    const audit = new AuthAuditRepository();
    const subjectId = randomUUID();
    await source.transaction((manager) =>
      audit.record(manager, {
        eventType: 'identity.login.failed',
        subjectId,
        outcome: 'denied',
        reasonCode: 'INVALID_CREDENTIALS',
        metadata: { factor: 'password' },
      }),
    );

    await expect(
      source.transaction((manager) =>
        audit.record(manager, {
          eventType: 'identity.login.failed',
          outcome: 'denied',
          metadata: {
            value: 'must-not-be-stored',
          } as unknown as AuthAuditMetadata,
        }),
      ),
    ).rejects.toThrow('unsupported field');
    await expect(
      source.transaction((manager) =>
        audit.record(manager, {
          eventType: 'identity.login.failed',
          actorId: 'person@example.test',
          outcome: 'denied',
        }),
      ),
    ).rejects.toThrow('principal identifier');
    const rows: unknown = await migrationSource.query(
      'SELECT subject_id AS "subjectId", reason_code AS "reasonCode" FROM audit_events',
    );
    expect(rows).toEqual([{ subjectId, reasonCode: 'INVALID_CREDENTIALS' }]);
  });

  it('completes registration, verification, login, recovery, and refresh reuse containment', async () => {
    const services = authLifecycleServices(source);
    const context = {
      ip: '203.0.113.80',
      requestId: 'auth-integration-1',
      traceId: '0123456789abcdef0123456789abcdef',
      deviceLabel: 'Integration Browser',
    };
    const email = 'identity-person@example.test';
    const initialPassword = 'initial-password-123';
    const replacementPassword = 'replacement-password-456';

    await services.lifecycle.register(email, initialPassword, context);
    await services.lifecycle.register(email, 'duplicate-password-789', context);
    expect(await countRows(source, 'users')).toBe(1);

    const verification = await latestAuthAction(
      source,
      services.envelopes,
      email,
      'verify_email',
    );
    await services.lifecycle.verifyEmail(verification, context);
    await expect(
      services.lifecycle.verifyEmail(verification, context),
    ).rejects.toMatchObject({ code: 'INVALID_ACTION_TOKEN' });

    await expect(
      services.lifecycle.login(email, 'incorrect-password-123', context),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const firstSession = await services.lifecycle.login(
      email,
      initialPassword,
      context,
    );
    await expect(
      services.accessTokens.verify(firstSession.accessToken),
    ).resolves.toMatchObject({
      userId: firstSession.user.id,
      sessionId: firstSession.sessionId,
      authzVersion: 1,
    });
    expect(firstSession.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(firstSession.user)).not.toContain('passwordHash');
    expect(Object.keys(firstSession.user).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerifiedAt',
      'id',
      'role',
      'status',
      'updatedAt',
      'version',
    ]);

    const existingRecoveryStartedAt = performance.now();
    await services.lifecycle.requestPasswordReset(email, context);
    const existingRecoveryDuration =
      performance.now() - existingRecoveryStartedAt;
    const absentRecoveryStartedAt = performance.now();
    await services.lifecycle.requestPasswordReset(
      'absent-identity@example.test',
      context,
    );
    const absentRecoveryDuration = performance.now() - absentRecoveryStartedAt;
    expect(existingRecoveryDuration).toBeGreaterThanOrEqual(275);
    expect(absentRecoveryDuration).toBeGreaterThanOrEqual(275);
    const reset = await latestAuthAction(
      source,
      services.envelopes,
      email,
      'reset_password',
    );
    const resetReplacement = reset.endsWith('A') ? 'B' : 'A';
    await expect(
      services.lifecycle.resetPassword(
        `${reset.slice(0, -1)}${resetReplacement}`,
        'short',
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ACTION_TOKEN' });
    await services.lifecycle.resetPassword(reset, replacementPassword, context);
    await expect(
      services.lifecycle.refresh(firstSession.refreshToken, context),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });
    await expect(
      services.lifecycle.login(email, initialPassword, context),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    const secondSession = await services.lifecycle.login(
      email,
      replacementPassword,
      context,
    );
    const concurrent = await Promise.allSettled([
      services.lifecycle.refresh(secondSession.refreshToken, context),
      services.lifecycle.refresh(secondSession.refreshToken, context),
    ]);
    const successes = concurrent.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<AuthLifecycleService['refresh']>>
      > => result.status === 'fulfilled',
    );
    expect(successes).toHaveLength(1);
    expect(
      concurrent.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    await expect(
      services.lifecycle.refresh(successes[0]!.value.refreshToken, context),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });

    const sessionRows: unknown = await source.query(
      `SELECT revoke_reason AS "revokeReason" FROM auth_sessions
       WHERE id = $1`,
      [secondSession.sessionId],
    );
    expect(sessionRows).toEqual([{ revokeReason: 'REFRESH_REUSE' }]);
  });

  it('shares refresh reuse containment and session revocation across independent replicas', async () => {
    const primary = authLifecycleServices(source);
    const replica = authLifecycleServices(replicaSource);
    const context = { ip: '203.0.113.82' };
    const email = 'replica-session@example.test';
    const password = 'replica-session-password-123';
    await primary.lifecycle.register(email, password, context);
    await primary.lifecycle.verifyEmail(
      await latestAuthAction(source, primary.envelopes, email, 'verify_email'),
      context,
    );
    const session = await primary.lifecycle.login(email, password, context);

    const refreshes = await Promise.allSettled([
      primary.lifecycle.refresh(session.refreshToken, context),
      replica.lifecycle.refresh(session.refreshToken, context),
    ]);
    const successfulRefreshes = refreshes.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<AuthLifecycleService['refresh']>>
      > => result.status === 'fulfilled',
    );
    expect(successfulRefreshes).toHaveLength(1);
    expect(
      refreshes.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    await expect(
      replica.lifecycle.refresh(
        successfulRefreshes[0]!.value.refreshToken,
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });

    const second = await primary.lifecycle.login(email, password, context);
    const principal = {
      user: second.user,
      sessionId: second.sessionId,
      lastPasswordAuthAt: new Date(),
    };
    await primary.lifecycle.revokeSession(principal, second.sessionId, context);
    await expectRejectedByDeadline(
      () => replica.lifecycle.authenticateAccess(second.accessToken),
      { code: 'INVALID_SESSION' },
    );
    await expectRejectedByDeadline(
      () => replica.lifecycle.refresh(second.refreshToken, context),
      { code: 'INVALID_SESSION' },
    );
  });

  it('fails closed when the authoritative database is unavailable for access and credential rate checks', async () => {
    const primary = authLifecycleServices(source);
    const context = { ip: '203.0.113.83' };
    const email = 'fault-closed@example.test';
    const password = 'fault-closed-password-123';
    await primary.lifecycle.register(email, password, context);
    await primary.lifecycle.verifyEmail(
      await latestAuthAction(source, primary.envelopes, email, 'verify_email'),
      context,
    );
    const session = await primary.lifecycle.login(email, password, context);

    await replicaSource.destroy();
    try {
      const unavailable = authLifecycleServices(replicaSource, source);
      await expect(
        unavailable.lifecycle.authenticateAccess(session.accessToken),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      await expect(
        unavailable.lifecycle.authenticateDeleteReplay(
          session.accessToken,
          'fault-injection',
        ),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      await expect(
        unavailable.lifecycle.authorizeRefresh(
          session.refreshToken,
          context.ip,
        ),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      await expect(
        unavailable.lifecycle.refresh(session.refreshToken, context),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      const unavailableRateStore = authLifecycleServices(replicaSource);
      await expect(
        unavailableRateStore.lifecycle.login(email, password, context),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    } finally {
      await replicaSource.initialize();
    }
  });

  it('manages only the authenticated user sessions and requires recent password authentication for global revoke', async () => {
    const services = authLifecycleServices(source);
    const context = { ip: '203.0.113.87' };
    const email = 'session-runtime@example.test';
    const password = 'session-runtime-password-123';
    const changedPassword = 'session-runtime-changed-456';
    await services.lifecycle.register(email, password, context);
    await services.lifecycle.verifyEmail(
      await latestAuthAction(source, services.envelopes, email, 'verify_email'),
      context,
    );
    const current = await services.lifecycle.login(email, password, context);
    const target = await services.lifecycle.login(email, password, context);
    const principal = {
      user: current.user,
      sessionId: current.sessionId,
      lastPasswordAuthAt: new Date(),
    };

    await expect(services.lifecycle.listSessions(principal)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: current.sessionId, current: true }),
        expect.objectContaining({ id: target.sessionId, current: false }),
      ]),
    );
    await expect(
      services.lifecycle.confirmRecentAuthentication(
        principal,
        'incorrect-session-password-123',
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await services.lifecycle.confirmRecentAuthentication(
      principal,
      password,
      context,
    );
    await source.query(
      `UPDATE auth_sessions SET last_password_auth_at = CURRENT_TIMESTAMP - INTERVAL '11 minutes'
       WHERE id = $1`,
      [current.sessionId],
    );
    await expect(
      services.lifecycle.revokeAllSessions(principal, context),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });

    await services.lifecycle.confirmRecentAuthentication(
      principal,
      password,
      context,
    );
    const refreshAndRevoke = await Promise.allSettled([
      services.lifecycle.refresh(target.refreshToken, context),
      services.lifecycle.revokeSession(principal, target.sessionId, context),
    ]);
    expect(refreshAndRevoke[1]).toMatchObject({ status: 'fulfilled' });
    if (refreshAndRevoke[0]?.status === 'rejected') {
      expect(refreshAndRevoke[0].reason).toMatchObject({
        code: 'INVALID_SESSION',
      });
    }
    await expect(services.lifecycle.listSessions(principal)).resolves.toEqual([
      expect.objectContaining({ id: current.sessionId, current: true }),
    ]);
    await services.lifecycle.changePassword(
      principal,
      password,
      changedPassword,
      context,
    );
    await expect(
      services.lifecycle.refresh(current.refreshToken, context),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });
    await expect(
      services.lifecycle.login(email, changedPassword, context),
    ).resolves.toMatchObject({ user: { id: current.user.id } });
    expect(
      await source.query(
        `SELECT authz_version AS "authzVersion", version FROM users WHERE id = $1`,
        [current.user.id],
      ),
    ).toEqual([{ authzVersion: 2, version: 2 }]);
    expect(
      await migrationSource.query(
        `SELECT event_type AS "eventType" FROM audit_events
         WHERE subject_id = $1 ORDER BY occurred_at, id`,
        [current.user.id],
      ),
    ).toEqual(
      expect.arrayContaining([
        { eventType: 'identity.recent_auth.confirmed' },
        { eventType: 'identity.session.revoked' },
        { eventType: 'identity.password.changed' },
      ]),
    );
  });

  it('applies idempotent admin mutations and terminal self deletion without reviving credentials', async () => {
    const services = authLifecycleServices(source);
    const users = new UsersService(
      source,
      new IdempotencyRepository(),
      new AuthAuditRepository(),
      new OutboxRepository(),
      authSecurityOptions(),
    );
    const context = { ip: '203.0.113.91' };
    const password = 'user-runtime-password-123';
    const adminEmail = 'runtime-admin@example.test';
    const targetEmail = 'runtime-target@example.test';
    for (const email of [adminEmail, targetEmail]) {
      await services.lifecycle.register(email, password, context);
      await services.lifecycle.verifyEmail(
        await latestAuthAction(
          source,
          services.envelopes,
          email,
          'verify_email',
        ),
        context,
      );
    }
    const adminSession = await services.lifecycle.login(
      adminEmail,
      password,
      context,
    );
    const targetSession = await services.lifecycle.login(
      targetEmail,
      password,
      context,
    );
    await source.query(
      `UPDATE users SET role = 'admin', authz_version = authz_version + 1,
         version = version + 1 WHERE id = $1`,
      [adminSession.user.id],
    );
    const adminPrincipal = {
      user: {
        ...adminSession.user,
        role: 'admin' as const,
        version: adminSession.user.version + 1,
      },
      sessionId: adminSession.sessionId,
      lastPasswordAuthAt: new Date(),
    };
    const headers = (version: number, idempotencyKey: string) => ({
      ifMatch: `"${version}"`,
      idempotencyKey,
    });

    await expect(users.list({ page: 1, pageSize: 10 })).resolves.toMatchObject({
      total: 2,
    });
    const promoted = await users.updateRole(
      adminPrincipal,
      targetSession.user.id,
      'admin',
      headers(targetSession.user.version, 'promote-target'),
    );
    await expect(
      users.updateRole(
        adminPrincipal,
        targetSession.user.id,
        'admin',
        headers(targetSession.user.version, 'promote-target'),
      ),
    ).resolves.toEqual(promoted);
    await expect(
      users.updateRole(
        adminPrincipal,
        targetSession.user.id,
        'user',
        headers(promoted.version, 'promote-target'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const persistedIdentity = readQueryRows<{
      scopeHash: string;
      idempotencyKey: string;
    }>(
      await source.query(
        `SELECT scope_hash AS "scopeHash", idempotency_key AS "idempotencyKey"
         FROM idempotency_records WHERE route_id = 'updateUserRole' LIMIT 1`,
      ),
    )[0];
    expect(persistedIdentity).toBeDefined();
    expect(persistedIdentity!.scopeHash).not.toBe(
      digest(adminPrincipal.user.id),
    );
    expect(persistedIdentity!.idempotencyKey).not.toBe('promote-target');

    const suspended = await users.updateStatus(
      adminPrincipal,
      targetSession.user.id,
      'suspended',
      headers(promoted.version, 'suspend-target'),
    );
    expect(suspended).toMatchObject({ role: 'admin', status: 'suspended' });
    await expect(
      services.lifecycle.refresh(targetSession.refreshToken, context),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });
    const activated = await users.updateStatus(
      adminPrincipal,
      targetSession.user.id,
      'active',
      headers(suspended.version, 'activate-target'),
    );
    const demoted = await users.updateRole(
      adminPrincipal,
      targetSession.user.id,
      'user',
      headers(activated.version, 'demote-target'),
    );
    await expect(
      users.updateStatus(
        adminPrincipal,
        adminPrincipal.user.id,
        'suspended',
        headers(adminPrincipal.user.version, 'suspend-last-admin'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const deletionSession = await services.lifecycle.login(
      targetEmail,
      password,
      context,
    );
    const deletionPrincipal = {
      user: deletionSession.user,
      sessionId: deletionSession.sessionId,
      lastPasswordAuthAt: new Date(),
    };
    await users.deleteCurrentUser(
      deletionPrincipal,
      headers(demoted.version, 'delete-target'),
    );
    await expect(
      users.deleteCurrentUser(
        deletionPrincipal,
        headers(demoted.version, 'delete-target'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      services.lifecycle.refresh(deletionSession.refreshToken, context),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });
    await services.lifecycle.register(targetEmail, password, context);
    expect(
      await source.query(
        `SELECT email_normalized AS email, status, role, password_hash AS "passwordHash"
         FROM users WHERE id = $1`,
        [targetSession.user.id],
      ),
    ).toEqual([
      {
        email: `deleted+${targetSession.user.id}@users.invalid`,
        status: 'deleted',
        role: 'user',
        passwordHash: null,
      },
    ]);
    expect(
      await source.query(
        `SELECT COUNT(*)::integer AS count FROM users
         WHERE email_normalized = $1 AND status = 'pending_verification'`,
        [targetEmail],
      ),
    ).toEqual([{ count: 1 }]);
    const pending = readQueryRows<{ id: string; version: number }>(
      await source.query(
        `SELECT id, version FROM users
         WHERE email_normalized = $1 AND status = 'pending_verification'`,
        [targetEmail],
      ),
    )[0];
    expect(pending).toBeDefined();
    await expect(
      users.updateStatus(
        adminPrincipal,
        pending!.id,
        'active',
        headers(pending!.version, 'activate-unverified'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      users.updateRole(
        adminPrincipal,
        pending!.id,
        'admin',
        headers(pending!.version, 'promote-unverified'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const adminDeleted = await users.updateStatus(
      adminPrincipal,
      pending!.id,
      'deleted',
      headers(pending!.version, 'delete-unverified'),
    );
    expect(adminDeleted).toMatchObject({ status: 'deleted', role: 'user' });
    expect(
      readQueryRows<{ eventType: string; reasonCode: string }>(
        await migrationSource.query(
          `SELECT event_type AS "eventType", reason_code AS "reasonCode"
           FROM audit_events WHERE subject_id = $1
             AND event_type IN ('identity.status.changed', 'identity.user.deleted')
           ORDER BY event_type`,
          [pending!.id],
        ),
      ),
    ).toEqual([
      { eventType: 'identity.status.changed', reasonCode: 'STATUS_CHANGED' },
      { eventType: 'identity.user.deleted', reasonCode: 'USER_DELETED' },
    ]);
    expect(
      await migrationSource.query(
        `SELECT COUNT(*)::integer AS count FROM outbox_events
         WHERE aggregate_id = $1 AND event_type = 'identity.user.delete.journaled'`,
        [pending!.id],
      ),
    ).toEqual([{ count: 1 }]);
  });

  it('bootstraps exactly one verified active administrator with the dedicated principal', async () => {
    const environment = validateAdminBootstrapEnvironment({
      ...process.env,
      DATABASE_ADMIN_BOOTSTRAP_URL:
        'postgresql://cornerstone_test_admin_bootstrap:cornerstone-test-admin-bootstrap@localhost:55432/cornerstone_test',
      ADMIN_BOOTSTRAP_EMAIL: 'bootstrap-admin@example.test',
      ADMIN_BOOTSTRAP_REQUEST_ID: 'integration-bootstrap',
    });
    const bootstrapSource = new DataSource(
      buildAdminBootstrapDatabaseOptions(environment),
    );
    await bootstrapSource.initialize();
    try {
      await expect(
        bootstrapSource.query('INSERT INTO users (id) VALUES ($1)', [
          randomUUID(),
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        bootstrapSource.query(
          'INSERT INTO admin_bootstrap_markers (singleton, user_id, created_at) VALUES (TRUE, $1, CURRENT_TIMESTAMP)',
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const deniedFunctionArguments = [
        randomUUID(),
        randomUUID(),
        'denied@example.test',
        '$argon2id$v=19$m=19456,p=1,t=2$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'direct-invalid-email',
      ];
      await expect(
        source.query(
          'SELECT * FROM public.cornerstone_bootstrap_initial_admin($1, $2, $3, $4, $5)',
          deniedFunctionArguments,
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        maintenanceSource.query(
          'SELECT * FROM public.cornerstone_bootstrap_initial_admin($1, $2, $3, $4, $5)',
          deniedFunctionArguments,
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const directFunctionArguments = [
        randomUUID(),
        randomUUID(),
        'a@b',
        '$argon2id$v=19$m=19456,p=1,t=2$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        null,
      ];
      await expect(
        bootstrapSource.query(
          'SELECT * FROM public.cornerstone_bootstrap_initial_admin($1, $2, $3, $4, $5)',
          directFunctionArguments,
        ),
      ).rejects.toMatchObject({ code: 'CSB03' });
      await expect(
        bootstrapSource.query(
          'SELECT * FROM public.cornerstone_bootstrap_initial_admin($1, $2, $3, $4, $5)',
          [
            randomUUID(),
            randomUUID(),
            'valid@example.test',
            '$argon2id$v=19$m=4096,p=1,t=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            'direct-invalid-hash',
          ],
        ),
      ).rejects.toMatchObject({ code: 'CSB04' });
      await expect(
        bootstrapSource.query(
          'SELECT * FROM public.cornerstone_bootstrap_initial_admin($1, $2, $3, $4, $5)',
          [
            randomUUID(),
            randomUUID(),
            'valid@example.test',
            '$argon2id$v=19$m=19456,p=1,t=2$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            null,
          ],
        ),
      ).rejects.toMatchObject({ code: 'CSB05' });
      expect(await countRows(migrationSource, 'admin_bootstrap_markers')).toBe(
        0,
      );
      const results = await Promise.allSettled([
        bootstrapInitialAdmin(bootstrapSource, {
          email: environment.ADMIN_BOOTSTRAP_EMAIL,
          password: Buffer.from('bootstrap-password-123'),
          requestId: environment.ADMIN_BOOTSTRAP_REQUEST_ID,
          argon2: { memoryCostKib: 19_456, timeCost: 2, parallelism: 1 },
        }),
        bootstrapInitialAdmin(bootstrapSource, {
          email: environment.ADMIN_BOOTSTRAP_EMAIL,
          password: Buffer.from('bootstrap-password-123'),
          requestId: environment.ADMIN_BOOTSTRAP_REQUEST_ID,
          argon2: { memoryCostKib: 19_456, timeCost: 2, parallelism: 1 },
        }),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === 'rejected'),
      ).toMatchObject({ reason: { code: 'ADMIN_EXISTS' } });
      const [admin] = readQueryRows<{
        id: string;
        passwordHash: string;
        verified: boolean;
        status: string;
        role: string;
      }>(
        await migrationSource.query(
          `SELECT id, password_hash AS "passwordHash",
             email_verified_at IS NOT NULL AS verified, status, role
           FROM users WHERE role = 'admin'`,
        ),
      );
      expect(admin).toMatchObject({
        verified: true,
        status: 'active',
        role: 'admin',
      });
      await expect(
        argon2.verify(admin!.passwordHash, 'bootstrap-password-123'),
      ).resolves.toBe(true);
      expect(
        await migrationSource.query(
          'SELECT singleton, user_id AS "userId" FROM admin_bootstrap_markers',
        ),
      ).toEqual([{ singleton: true, userId: admin!.id }]);
      expect(
        await migrationSource.query(
          `SELECT event_type AS "eventType", actor_id AS "actorId",
             subject_id AS "subjectId", outcome, reason_code AS "reasonCode",
             request_id AS "requestId"
           FROM audit_events WHERE subject_id = $1`,
          [admin!.id],
        ),
      ).toEqual([
        {
          eventType: 'identity.admin.bootstrap',
          actorId: 'system:admin-bootstrap',
          subjectId: admin!.id,
          outcome: 'success',
          reasonCode: 'INITIAL_ADMIN_CREATED',
          requestId: 'integration-bootstrap',
        },
      ]);
      expect(
        await bootstrapSource.query(
          `SELECT
             has_table_privilege(current_user, 'users', 'UPDATE') AS "hasUpdate",
             has_column_privilege(current_user, 'users', 'email_normalized', 'SELECT') AS "readsEmail",
             has_column_privilege(current_user, 'users', 'password_hash', 'SELECT') AS "readsPasswordHash"`,
        ),
      ).toEqual([
        { hasUpdate: false, readsEmail: false, readsPasswordHash: false },
      ]);
    } finally {
      await bootstrapSource.destroy();
    }
  });

  it('revokes an action token after its bounded invalid attempts', async () => {
    const services = authLifecycleServices(source);
    const context = { ip: '198.51.100.81' };
    const email = 'bounded-action@example.test';
    await services.lifecycle.register(
      email,
      'bounded-action-password-123',
      context,
    );
    const verification = await latestAuthAction(
      source,
      services.envelopes,
      email,
      'verify_email',
    );
    const replacement = verification.endsWith('A') ? 'B' : 'A';
    const tampered = `${verification.slice(0, -1)}${replacement}`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        services.lifecycle.verifyEmail(tampered, context),
      ).rejects.toMatchObject({ code: 'INVALID_ACTION_TOKEN' });
    }
    const rows: unknown = await source.query(
      `SELECT attempt_count AS "attemptCount", revoked_at IS NOT NULL AS revoked
       FROM auth_action_tokens`,
    );
    expect(rows).toEqual([{ attemptCount: 5, revoked: true }]);
    await expect(
      services.lifecycle.verifyEmail(verification, context),
    ).rejects.toMatchObject({ code: 'INVALID_ACTION_TOKEN' });
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

  it('cleans expired operational data in bounded least-privilege batches', async () => {
    const now = new Date('2026-08-13T00:00:00.000Z');
    const old = new Date('2025-01-01T00:00:00.000Z');
    const userId = randomUUID();
    const sessionId = randomUUID();
    await source.query(
      `INSERT INTO users (
         id, email_normalized, password_hash, status, role, authz_version,
         version, created_at, updated_at
       ) VALUES ($1, $2, NULL, 'pending_verification', 'user', 0, 0, $3, $3)`,
      [userId, `retention-${userId}@example.test`, old],
    );
    await source.query(
      `INSERT INTO auth_sessions (
         id, family_id, user_id, current_generation, last_password_auth_at,
         last_seen_at, idle_expires_at, absolute_expires_at, revoked_at,
         revoke_reason, version, created_at, updated_at
       ) VALUES ($1, $2, $3, 0, $4, $4, $4, $4, $4, 'EXPIRED', 0, $4, $4)`,
      [sessionId, randomUUID(), userId, old],
    );
    await source.query(
      `INSERT INTO auth_refresh_tokens (
         id, session_id, generation, token_hash, key_version, expires_at,
         consumed_at, created_at
       ) VALUES ($1, $2, 0, $3, 'test-v1', $4, $4, $4)`,
      [randomUUID(), sessionId, digest(randomUUID()), old],
    );
    await source.query(
      `INSERT INTO auth_action_tokens (
         id, user_id, purpose, token_hash, key_version, attempt_count,
         max_attempts, expires_at, consumed_at, created_at
       ) VALUES ($1, $2, 'verify_email', $3, 'test-v1', 1, 5, $4, $4, $4)`,
      [randomUUID(), userId, digest(randomUUID()), old],
    );
    for (const key of ['expired-one', 'expired-two']) {
      await source.query(
        `INSERT INTO idempotency_records (
           id, scope_hash, idempotency_key, method, route_id, payload_sha256,
           state, expires_at, created_at, updated_at
         ) VALUES ($1, $2, $3, 'POST', 'retention.test', $4, 'pending', $5, $5, $5)`,
        [randomUUID(), digest('retention'), key, digest(key), old],
      );
    }
    await source.query(
      `INSERT INTO rate_limit_buckets (
         id, subject_hash, policy_id, window_start, count, expires_at,
         created_at, updated_at
       ) VALUES ($1, $2, 'retention-test', $3, 1, $3, $3, $3)`,
      [randomUUID(), digest('subject'), old],
    );
    await source.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, aggregate_id, payload, attempts,
         max_attempts, available_at, processed_at, created_at, updated_at
       ) VALUES
         ($1, 'retention.processed', 1, $2, '{}', 1, 3, $3, $3, $3, $3),
         ($4, 'retention.poison', 1, $2, '{}', 3, 3, $3, $3, $3, $3)`,
      [randomUUID(), userId, old, randomUUID()],
    );
    await source.query(
      `UPDATE outbox_events SET last_error_code = 'POISON'
       WHERE event_type = 'retention.poison'`,
    );
    await source.query(
      `INSERT INTO audit_events (
         id, event_type, event_version, subject_id, outcome, metadata,
         occurred_at, recorded_at
       ) VALUES ($1, 'retention.test', 1, $2, 'success', '{}', $3, $3)`,
      [randomUUID(), userId, old],
    );

    await expect(
      cleanupExpiredOperationalData(maintenanceSource, {
        batchSize: 1,
        now,
      }),
    ).resolves.toEqual({
      sessions: 1,
      actionTokens: 1,
      idempotency: 1,
      rateLimits: 1,
      outboxProcessed: 1,
      outboxPoison: 1,
      audit: 1,
    });
    expect(await countRows(source, 'idempotency_records')).toBe(1);
    expect(await countRows(source, 'auth_refresh_tokens')).toBe(0);
    expect(await countRows(source, 'users')).toBeGreaterThan(0);

    const second = await cleanupExpiredOperationalData(maintenanceSource, {
      batchSize: 1,
      now,
    });
    expect(second.idempotency).toBe(1);
    expect(await countRows(source, 'idempotency_records')).toBe(0);
    await expect(
      maintenanceSource.query(
        'SELECT * FROM cornerstone_cleanup_retention(NULL, $1::timestamptz)',
        [now],
      ),
    ).rejects.toThrow('retention batch size must be 1..1000');
  });

  afterAll(async () => {
    await maintenanceSource.destroy();
    await migrationSource.destroy();
    await replicaSource.destroy();
    await source.destroy();
  });
});

async function countRows(source: DataSource, table: string): Promise<number> {
  if (
    ![
      'admin_bootstrap_markers',
      'auth_refresh_tokens',
      'idempotency_records',
      'outbox_events',
      'users',
    ].includes(table)
  ) {
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

function authLifecycleServices(source: DataSource, rateLimitSource = source) {
  const options = configuration().auth;
  const accessTokens = new AccessTokenService(options);
  const envelopes = new MailOutboxEnvelopeService(options);
  return {
    accessTokens,
    envelopes,
    lifecycle: new AuthLifecycleService(
      source,
      new PasswordService(options),
      new OpaqueTokenService(options),
      accessTokens,
      new AuthRateLimitService(rateLimitSource, options),
      new AuthAuditRepository(),
      new AuthMailOutboxService(new OutboxRepository(), envelopes),
      options,
    ),
  };
}

async function expectRejectedByDeadline(
  operation: () => Promise<unknown>,
  expected: object,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  for (;;) {
    try {
      await operation();
    } catch (error) {
      expect(error).toMatchObject(expected);
      return;
    }
    if (performance.now() >= deadline) {
      throw new Error(
        'Replica accepted a revoked credential past the 5 second deadline',
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

async function latestAuthAction(
  source: DataSource,
  envelopes: MailOutboxEnvelopeService,
  email: string,
  purpose: AuthMailPurpose,
): Promise<string> {
  const eventType =
    purpose === 'verify_email'
      ? 'identity.mail.verification.requested'
      : 'identity.mail.password.reset.requested';
  const rows: unknown = await source.query(
    `SELECT event.aggregate_id AS "userId", event.payload
     FROM outbox_events event
     JOIN users u ON u.id = event.aggregate_id
     WHERE u.email_normalized = $1 AND event.event_type = $2
     ORDER BY event.created_at DESC, event.id DESC LIMIT 1`,
    [email, eventType],
  );
  if (!Array.isArray(rows) || !rows[0]) {
    throw new Error('Expected an auth mail outbox event');
  }
  const row = rows[0] as {
    readonly userId: string;
    readonly payload: { readonly sealed: SealedMailEnvelope };
  };
  return envelopes.open(row.payload.sealed, {
    userId: row.userId,
    purpose,
    eventType,
    eventVersion: 1,
  }).actionValue;
}

function authSecurityOptions(): AuthSecurityOptions {
  return {
    rateLimitSecret: Buffer.alloc(32, 7).toString('base64url'),
    idempotencySecret: Buffer.alloc(32, 9).toString('base64url'),
    mailOutbox: {
      current: {
        id: 'mail-v2',
        secret: Buffer.alloc(32, 8).toString('base64url'),
      },
      previous: undefined,
    },
  } as AuthSecurityOptions;
}
