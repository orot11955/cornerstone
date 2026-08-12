import { createHmac } from 'node:crypto';
import { decodeProtectedHeader, SignJWT } from 'jose';
import { AccessTokenService } from './access-token.service.js';
import type { AuthSecurityOptions } from './auth-security.options.js';
import {
  clearAuthCookie,
  createAuthCookiePolicy,
  issueAuthCookie,
} from './auth-cookie.policy.js';
import { CsrfTokenService } from './csrf-token.service.js';
import { OpaqueTokenService } from './opaque-token.service.js';
import { PasswordService } from './password.service.js';

const userId = '1760cd9c-485d-4cd4-8f66-34997121cd00';
const sessionId = '9949809e-bf1c-49d9-86ed-91521075ba38';
const now = new Date('2026-08-13T00:00:00.000Z');

describe('AccessTokenService', () => {
  it('issues the exact access JWT profile and verifies its principal', async () => {
    const service = new AccessTokenService(options());
    const token = await service.issue(
      { userId, sessionId, authzVersion: 7 },
      now,
    );

    expect(decodeProtectedHeader(token)).toEqual({
      alg: 'HS256',
      kid: 'access-v2',
      typ: 'at+jwt',
    });
    await expect(service.verify(token, now)).resolves.toMatchObject({
      userId,
      sessionId,
      authzVersion: 7,
      issuedAt: now,
      expiresAt: new Date('2026-08-13T00:10:00.000Z'),
    });
  });

  it('verifies N-1 but signs only with the current key', async () => {
    const oldOptions = options();
    oldOptions.accessToken.current = oldOptions.accessToken.previous!;
    oldOptions.accessToken.previous = undefined;
    const oldToken = await new AccessTokenService(oldOptions).issue(
      { userId, sessionId, authzVersion: 0 },
      now,
    );
    const currentService = new AccessTokenService(options());

    expect(decodeProtectedHeader(oldToken).kid).toBe('access-v1');
    await expect(currentService.verify(oldToken, now)).resolves.toMatchObject({
      userId,
    });
    expect(
      decodeProtectedHeader(
        await currentService.issue({ userId, sessionId, authzVersion: 0 }, now),
      ).kid,
    ).toBe('access-v2');
  });

  it.each([
    ['wrong algorithm', { alg: 'HS384', kid: 'access-v2', typ: 'at+jwt' }],
    ['unknown key', { alg: 'HS256', kid: 'unknown', typ: 'at+jwt' }],
    ['wrong type', { alg: 'HS256', kid: 'access-v2', typ: 'JWT' }],
  ])('rejects %s', async (_name, header) => {
    const token = await signedFixture(header, {
      iss: 'cornerstone-api',
      aud: 'cornerstone-web',
      sub: userId,
      sid: sessionId,
      av: 0,
      iat: seconds(now),
      nbf: seconds(now),
      exp: seconds(now) + 600,
      jti: '0aa24797-9d1c-456c-96c4-2fb49aaec203',
    });
    await expect(
      new AccessTokenService(options()).verify(token, now),
    ).rejects.toThrow('Invalid authentication token');
  });

  it('rejects wrong claims, future tokens, expiry, and an extended lifetime', async () => {
    const service = new AccessTokenService(options());
    const valid = {
      iss: 'cornerstone-api',
      aud: 'cornerstone-web',
      sub: userId,
      sid: sessionId,
      av: 0,
      iat: seconds(now),
      nbf: seconds(now),
      exp: seconds(now) + 600,
      jti: '0aa24797-9d1c-456c-96c4-2fb49aaec203',
    };
    const invalid = [
      { ...valid, iss: 'other-api' },
      { ...valid, aud: 'other-web' },
      { ...valid, aud: ['cornerstone-web'] },
      { ...valid, nbf: seconds(now) + 60, iat: seconds(now) + 60 },
      { ...valid, exp: seconds(now) - 31 },
      { ...valid, exp: seconds(now) + 601 },
      { ...valid, av: -1 },
      { ...valid, sid: 'not-a-uuid' },
    ];

    for (const payload of invalid) {
      const token = await signedFixture(
        { alg: 'HS256', kid: 'access-v2', typ: 'at+jwt' },
        payload,
      );
      await expect(service.verify(token, now)).rejects.toThrow(
        'Invalid authentication token',
      );
    }
  });

  it('rejects duplicate protected header members', async () => {
    const service = new AccessTokenService(options());
    const valid = await service.issue(
      { userId, sessionId, authzVersion: 0 },
      now,
    );
    const [, payload] = valid.split('.');
    const header = Buffer.from(
      '{"alg":"HS256","kid":"access-v2","kid":"access-v2","typ":"at+jwt"}',
    ).toString('base64url');
    const unsigned = `${header}.${payload}`;
    const signature = createHmac(
      'sha256',
      Buffer.from(key('access-v2', 'access-current').secret, 'base64url'),
    )
      .update(unsigned)
      .digest('base64url');

    await expect(
      service.verify(`${unsigned}.${signature}`, now),
    ).rejects.toThrow('Invalid authentication token');
  });
});

describe('OpaqueTokenService', () => {
  it('issues 256-bit purpose-bound tokens without retaining the raw value', () => {
    const service = new OpaqueTokenService(options());
    const issued = service.issue('refresh');

    expect(issued.value.split('.')[0]).toBe('refresh-v2');
    expect(Buffer.from(issued.value.split('.')[1]!, 'base64url')).toHaveLength(
      32,
    );
    expect(issued.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.hash).not.toContain(issued.value);
    expect(
      service.matches('refresh', issued.value, issued.hash, issued.keyVersion),
    ).toBe(true);
    expect(
      service.matches(
        'verify_email',
        issued.value,
        issued.hash,
        issued.keyVersion,
      ),
    ).toBe(false);
  });

  it('supports N-1 verification and rejects tampering or key confusion', () => {
    const oldOptions = options();
    oldOptions.refreshToken.current = oldOptions.refreshToken.previous!;
    oldOptions.refreshToken.previous = undefined;
    const issued = new OpaqueTokenService(oldOptions).issue('refresh');
    const service = new OpaqueTokenService(options());

    expect(
      service.matches('refresh', issued.value, issued.hash, 'refresh-v1'),
    ).toBe(true);
    expect(
      service.matches('refresh', `${issued.value}x`, issued.hash, 'refresh-v1'),
    ).toBe(false);
    expect(
      service.matches('refresh', issued.value, issued.hash, 'refresh-v2'),
    ).toBe(false);
  });

  it('verifies N-1 action tokens with the action keyring only', () => {
    const oldOptions = options();
    oldOptions.actionToken.current = oldOptions.actionToken.previous!;
    oldOptions.actionToken.previous = undefined;
    const issued = new OpaqueTokenService(oldOptions).issue(
      'reset_password',
      userId,
    );

    expect(
      new OpaqueTokenService(options()).matches(
        'reset_password',
        issued.value,
        issued.hash,
        issued.keyVersion,
      ),
    ).toBe(true);
    expect(
      new OpaqueTokenService(options()).actionReference(issued.value),
    ).toEqual({ keyVersion: 'action-v1', recordId: userId });
  });
});

describe('CsrfTokenService', () => {
  it('binds a 256-bit token to a session and compares cookie/header exactly', () => {
    const service = new CsrfTokenService(options());
    const token = service.issue(`session:${sessionId}`);

    expect(Buffer.from(token.split('.')[1]!, 'base64url')).toHaveLength(32);
    expect(service.verify(token, token, `session:${sessionId}`)).toBe(true);
    expect(service.verify(token, `${token}x`, `session:${sessionId}`)).toBe(
      false,
    );
    expect(service.verify(token, token, 'preauth:nonce')).toBe(false);
    expect(
      service.verify(`${token}x`, `${token}x`, `session:${sessionId}`),
    ).toBe(false);
  });

  it('verifies N-1 CSRF signatures while issuing only with current', () => {
    const oldOptions = options();
    oldOptions.csrf.current = oldOptions.csrf.previous!;
    oldOptions.csrf.previous = undefined;
    const binding = `session:${sessionId}` as const;
    const oldToken = new CsrfTokenService(oldOptions).issue(binding);
    const service = new CsrfTokenService(options());

    expect(oldToken.startsWith('csrf-v1.')).toBe(true);
    expect(service.verify(oldToken, oldToken, binding)).toBe(true);
    expect(service.issue(binding).startsWith('csrf-v2.')).toBe(true);
  });
});

describe('PasswordService', () => {
  it('hashes with Argon2id, verifies, and identifies a weaker cost', async () => {
    const service = new PasswordService(options());
    const hash = await service.hash('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(
      service.verify(hash, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong password')).resolves.toBe(false);
    await expect(
      service.verify(
        hash.replace('$argon2id$', '$argon2i$'),
        'correct horse battery staple',
      ),
    ).resolves.toBe(false);
    expect(service.needsRehash(hash)).toBe(false);

    const weaker = new PasswordService({
      ...options(),
      password: {
        memoryCostKib: 8_192,
        timeCost: 1,
        parallelism: 1,
        hashLength: 32,
        maxConcurrent: 2,
        maxQueue: 100,
      },
    });
    const weakHash = await weaker.hash('correct horse battery staple');
    expect(service.needsRehash(weakHash)).toBe(true);
  });

  it('enforces Unicode code-point length without UTF-16 ambiguity', async () => {
    const service = new PasswordService(options());
    await expect(service.hash('😀'.repeat(11))).rejects.toThrow(
      'between 12 and 128 Unicode code points',
    );
    await expect(service.hash('😀'.repeat(12))).resolves.toMatch(
      /^\$argon2id\$/,
    );
    await expect(service.hash('😀'.repeat(129))).rejects.toThrow(
      'between 12 and 128 Unicode code points',
    );
  });

  it('rejects pathological PHC costs before native verification', async () => {
    const service = new PasswordService(options());
    const malicious =
      '$argon2id$v=19$m=1048576,t=10,p=16$c2FsdHNhbHRzYWx0c2FsdA$' +
      'aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA';

    await expect(
      service.verify(malicious, 'irrelevant-password'),
    ).resolves.toBe(false);
    expect(service.needsRehash(malicious)).toBe(true);
  });

  it('applies bounded backpressure to password work', async () => {
    const bounded = new PasswordService({
      ...options(),
      password: {
        ...options().password,
        maxConcurrent: 1,
        maxQueue: 0,
      },
    });
    const first = bounded.hash('first password fixture');

    await expect(bounded.hash('second password fixture')).rejects.toThrow(
      'Password work queue is full',
    );
    await expect(first).resolves.toMatch(/^\$argon2id\$/);
  });
});

describe('createAuthCookiePolicy', () => {
  it('uses host-only production names and symmetric clear attributes', () => {
    const policy = createAuthCookiePolicy('production');

    expect(policy.access.name).toBe('__Host-cs_access');
    expect(policy.refresh.name).toBe('__Host-cs_refresh');
    expect(policy.csrf.name).toBe('__Host-cs_csrf');
    expect(policy.access.issue).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600_000,
    });
    expect(policy.refresh.issue.sameSite).toBe('strict');
    expect(policy.csrf.issue.httpOnly).toBe(false);

    for (const cookie of Object.values(policy)) {
      expect(cookie.issue).toMatchObject(cookie.clear);
      expect(cookie.issue).not.toHaveProperty('domain');
      expect(cookie.clear).not.toHaveProperty('domain');
    }
  });

  it('uses explicit non-Host local development names', () => {
    const policy = createAuthCookiePolicy('development');
    expect(policy.access.name).toBe('cs_access');
    expect(policy.access.issue.secure).toBe(false);
  });

  it('routes issuance and deletion through matching Express APIs', () => {
    const policy = createAuthCookiePolicy('production');
    const issued: unknown[][] = [];
    const cleared: unknown[][] = [];
    const response = {
      cookie: (...args: unknown[]) => issued.push(args),
      clearCookie: (...args: unknown[]) => cleared.push(args),
    };

    issueAuthCookie(response, policy.access, 'access-token');
    clearAuthCookie(response, policy.access);

    expect(issued).toEqual([
      [policy.access.name, 'access-token', policy.access.issue],
    ]);
    expect(cleared).toEqual([[policy.access.name, policy.access.clear]]);
  });
});

function options(): AuthSecurityOptions {
  return {
    accessToken: {
      issuer: 'cornerstone-api',
      audience: 'cornerstone-web',
      ttlSeconds: 600,
      clockToleranceSeconds: 30,
      current: key('access-v2', 'access-current'),
      previous: key('access-v1', 'access-previous'),
    },
    refreshToken: {
      current: key('refresh-v2', 'refresh-current'),
      previous: key('refresh-v1', 'refresh-previous'),
      idleTtlSeconds: 7 * 24 * 60 * 60,
      absoluteTtlSeconds: 30 * 24 * 60 * 60,
    },
    actionToken: {
      current: key('action-v2', 'action-current'),
      previous: key('action-v1', 'action-previous'),
    },
    csrf: {
      current: key('csrf-v2', 'csrf-current'),
      previous: key('csrf-v1', 'csrf-previous'),
    },
    rateLimitSecret: secret('rate-limit'),
    mailOutbox: {
      current: {
        id: 'mail-v2',
        secret: Buffer.from('mail-current-key-material-32byte').toString(
          'base64url',
        ),
      },
      previous: {
        id: 'mail-v1',
        secret: Buffer.from('mail-previous-key-material-32byt').toString(
          'base64url',
        ),
      },
    },
    secretProvenance: { provider: 'local', reference: undefined },
    password: {
      memoryCostKib: 19_456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
      maxConcurrent: 2,
      maxQueue: 100,
    },
  };
}

function key(id: string, label: string): { id: string; secret: string } {
  return { id, secret: secret(label) };
}

function secret(label: string): string {
  return Buffer.from(`${label}-key-material-at-least-32-bytes`).toString(
    'base64url',
  );
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

async function signedFixture(
  header: { alg: string; kid: string; typ: string },
  payload: Record<string, unknown>,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader(header)
    .sign(Buffer.from(key('access-v2', 'access-current').secret, 'base64url'));
}
