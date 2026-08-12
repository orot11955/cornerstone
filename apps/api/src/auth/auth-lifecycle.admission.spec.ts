import type { DataSource } from 'typeorm';
import type { AccessTokenService } from './access-token.service.js';
import type { AuthAuditRepository } from './auth-audit.repository.js';
import { AuthLifecycleService } from './auth-lifecycle.service.js';
import type { AuthMailOutboxService } from './auth-mail-outbox.service.js';
import type { AuthRateLimitService } from './auth-rate-limit.service.js';
import type { AuthSecurityOptions } from './auth-security.options.js';
import type { OpaqueTokenService } from './opaque-token.service.js';
import type { PasswordService } from './password.service.js';

describe('AuthLifecycleService refresh admission', () => {
  it('rejects an IP-limited request before parsing or querying the refresh token', async () => {
    let tokenQueries = 0;
    const source = {
      query: () => {
        tokenQueries += 1;
        return Promise.resolve([]);
      },
    } as unknown as DataSource;
    const rateLimits = {
      consume: () => Promise.resolve({ allowed: false, retryAfterSeconds: 17 }),
    } as unknown as AuthRateLimitService;
    const lifecycle = new AuthLifecycleService(
      source,
      {} as PasswordService,
      {} as OpaqueTokenService,
      {} as AccessTokenService,
      rateLimits,
      {} as AuthAuditRepository,
      {} as AuthMailOutboxService,
      {} as AuthSecurityOptions,
    );

    await expect(
      lifecycle.authorizeRefresh('invalid-token', '203.0.113.9'),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 17,
    });
    expect(tokenQueries).toBe(0);
  });
});
