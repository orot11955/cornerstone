import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { InvalidAuthTokenError } from './auth-crypto.error.js';
import {
  AUTH_SECURITY_OPTIONS,
  type AuthSecurityOptions,
  type VersionedSecret,
} from './auth-security.options.js';

export interface AccessTokenPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly authzVersion: number;
}

export interface VerifiedAccessToken extends AccessTokenPrincipal {
  readonly tokenId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AccessTokenService {
  private readonly current: DecodedSecret;
  private readonly previous: DecodedSecret | undefined;

  constructor(
    @Inject(AUTH_SECURITY_OPTIONS)
    private readonly options: AuthSecurityOptions,
  ) {
    this.current = decodeSecret(options.accessToken.current);
    this.previous = options.accessToken.previous
      ? decodeSecret(options.accessToken.previous)
      : undefined;
  }

  async issue(
    principal: AccessTokenPrincipal,
    issuedAt = new Date(),
  ): Promise<string> {
    assertUuid(principal.userId);
    assertUuid(principal.sessionId);
    if (
      !Number.isSafeInteger(principal.authzVersion) ||
      principal.authzVersion < 0
    ) {
      throw new TypeError('authzVersion must be a non-negative safe integer');
    }

    const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1000);
    return new SignJWT({
      sid: principal.sessionId,
      av: principal.authzVersion,
    })
      .setProtectedHeader({
        alg: 'HS256',
        kid: this.current.id,
        typ: 'at+jwt',
      })
      .setIssuer(this.options.accessToken.issuer)
      .setAudience(this.options.accessToken.audience)
      .setSubject(principal.userId)
      .setJti(randomUUID())
      .setIssuedAt(issuedAtSeconds)
      .setNotBefore(issuedAtSeconds)
      .setExpirationTime(issuedAtSeconds + this.options.accessToken.ttlSeconds)
      .sign(this.current.secret);
  }

  async verify(token: string, now = new Date()): Promise<VerifiedAccessToken> {
    try {
      if (token.length === 0 || token.length > 4_096) {
        throw new InvalidAuthTokenError();
      }
      assertCanonicalProtectedHeader(token);

      const result = await jwtVerify(
        token,
        (header) => {
          if (
            header.alg !== 'HS256' ||
            header.typ !== 'at+jwt' ||
            typeof header.kid !== 'string'
          ) {
            throw new InvalidAuthTokenError();
          }
          const key = [this.current, this.previous].find(
            (candidate) => candidate?.id === header.kid,
          );
          if (!key) throw new InvalidAuthTokenError();
          return key.secret;
        },
        {
          algorithms: ['HS256'],
          issuer: this.options.accessToken.issuer,
          audience: this.options.accessToken.audience,
          typ: 'at+jwt',
          clockTolerance: this.options.accessToken.clockToleranceSeconds,
          maxTokenAge: this.options.accessToken.ttlSeconds,
          currentDate: now,
          requiredClaims: ['sub', 'sid', 'av', 'iat', 'nbf', 'exp', 'jti'],
        },
      );

      return validatePayload(
        result.payload,
        this.options.accessToken.ttlSeconds,
        this.options.accessToken.issuer,
        this.options.accessToken.audience,
      );
    } catch {
      throw new InvalidAuthTokenError();
    }
  }
}

interface DecodedSecret {
  readonly id: string;
  readonly secret: Uint8Array;
}

function decodeSecret(secret: VersionedSecret): DecodedSecret {
  return {
    id: secret.id,
    secret: Buffer.from(secret.secret, 'base64url'),
  };
}

function validatePayload(
  payload: JWTPayload,
  ttlSeconds: number,
  issuer: string,
  audience: string,
): VerifiedAccessToken {
  const { iss, aud, sub, sid, av, jti, iat, nbf, exp } = payload;
  if (
    iss !== issuer ||
    aud !== audience ||
    typeof sub !== 'string' ||
    !UUID_V4.test(sub) ||
    typeof sid !== 'string' ||
    !UUID_V4.test(sid) ||
    typeof jti !== 'string' ||
    !UUID_V4.test(jti) ||
    !Number.isSafeInteger(av) ||
    Number(av) < 0 ||
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(nbf) ||
    !Number.isSafeInteger(exp) ||
    nbf !== iat ||
    Number(exp) - Number(iat) !== ttlSeconds
  ) {
    throw new InvalidAuthTokenError();
  }

  return {
    userId: sub,
    sessionId: sid,
    authzVersion: Number(av),
    tokenId: jti,
    issuedAt: new Date(Number(iat) * 1000),
    expiresAt: new Date(Number(exp) * 1000),
  };
}

function assertUuid(value: string): void {
  if (!UUID_V4.test(value))
    throw new TypeError('Expected a UUID v4 identifier');
}

function assertCanonicalProtectedHeader(token: string): void {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || parts[0].length > 512) {
    throw new InvalidAuthTokenError();
  }
  const bytes = Buffer.from(parts[0], 'base64url');
  if (bytes.toString('base64url') !== parts[0]) {
    throw new InvalidAuthTokenError();
  }
  const json = bytes.toString('utf8');
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    JSON.stringify(parsed) !== json
  ) {
    throw new InvalidAuthTokenError();
  }
  if (Object.keys(parsed).sort().join(',') !== 'alg,kid,typ') {
    throw new InvalidAuthTokenError();
  }
}
