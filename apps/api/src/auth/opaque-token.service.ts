import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { InvalidAuthTokenError } from './auth-crypto.error.js';
import {
  AUTH_SECURITY_OPTIONS,
  type AuthSecurityOptions,
  type VersionedSecret,
} from './auth-security.options.js';

export type OpaqueTokenPurpose = 'refresh' | 'verify_email' | 'reset_password';

export interface IssuedOpaqueToken {
  readonly value: string;
  readonly hash: string;
  readonly keyVersion: string;
}

@Injectable()
export class OpaqueTokenService {
  private readonly refreshKeys: KeySet;
  private readonly actionKeys: KeySet;

  constructor(@Inject(AUTH_SECURITY_OPTIONS) options: AuthSecurityOptions) {
    this.refreshKeys = decodeKeySet(
      options.refreshToken.current,
      options.refreshToken.previous,
    );
    this.actionKeys = decodeKeySet(
      options.actionToken.current,
      options.actionToken.previous,
    );
  }

  issue(purpose: OpaqueTokenPurpose): IssuedOpaqueToken {
    const keys = this.keysFor(purpose);
    const random = randomBytes(32).toString('base64url');
    const value = `${keys.current.id}.${random}`;
    return {
      value,
      hash: hashToken(keys.current.secret, purpose, value),
      keyVersion: keys.current.id,
    };
  }

  hash(
    purpose: OpaqueTokenPurpose,
    value: string,
  ): {
    readonly hash: string;
    readonly keyVersion: string;
  } {
    const { key, canonicalValue } = this.resolve(purpose, value);
    return {
      hash: hashToken(key.secret, purpose, canonicalValue),
      keyVersion: key.id,
    };
  }

  matches(
    purpose: OpaqueTokenPurpose,
    value: string,
    expectedHash: string,
    expectedKeyVersion: string,
  ): boolean {
    try {
      if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false;
      const { key, canonicalValue } = this.resolve(purpose, value);
      if (key.id !== expectedKeyVersion) return false;
      const actual = Buffer.from(
        hashToken(key.secret, purpose, canonicalValue),
        'hex',
      );
      return timingSafeEqual(actual, Buffer.from(expectedHash, 'hex'));
    } catch {
      return false;
    }
  }

  private resolve(
    purpose: OpaqueTokenPurpose,
    value: string,
  ): { readonly key: DecodedKey; readonly canonicalValue: string } {
    if (value.length > 256) throw new InvalidAuthTokenError();
    const parts = value.split('.');
    if (
      parts.length !== 2 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(parts[0] ?? '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[1] ?? '')
    ) {
      throw new InvalidAuthTokenError();
    }
    const keys = this.keysFor(purpose);
    const key = [keys.current, keys.previous].find(
      (candidate) => candidate?.id === parts[0],
    );
    if (!key) throw new InvalidAuthTokenError();
    return { key, canonicalValue: value };
  }

  private keysFor(purpose: OpaqueTokenPurpose): KeySet {
    return purpose === 'refresh' ? this.refreshKeys : this.actionKeys;
  }
}

interface DecodedKey {
  readonly id: string;
  readonly secret: Buffer;
}

interface KeySet {
  readonly current: DecodedKey;
  readonly previous: DecodedKey | undefined;
}

function decodeKeySet(
  current: VersionedSecret,
  previous?: VersionedSecret,
): KeySet {
  return {
    current: decodeKey(current),
    previous: previous ? decodeKey(previous) : undefined,
  };
}

function decodeKey(key: VersionedSecret): DecodedKey {
  return { id: key.id, secret: Buffer.from(key.secret, 'base64url') };
}

function hashToken(
  secret: Buffer,
  purpose: OpaqueTokenPurpose,
  value: string,
): string {
  return createHmac('sha256', secret)
    .update('cornerstone-auth-token\0', 'utf8')
    .update(purpose, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}
