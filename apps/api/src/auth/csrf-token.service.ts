import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  AUTH_SECURITY_OPTIONS,
  type AuthSecurityOptions,
  type VersionedSecret,
} from './auth-security.options.js';

export type CsrfBinding = `preauth:${string}` | `session:${string}`;

@Injectable()
export class CsrfTokenService {
  private readonly current: DecodedKey;
  private readonly previous: DecodedKey | undefined;

  constructor(@Inject(AUTH_SECURITY_OPTIONS) options: AuthSecurityOptions) {
    this.current = decodeKey(options.csrf.current);
    this.previous = options.csrf.previous
      ? decodeKey(options.csrf.previous)
      : undefined;
  }

  issue(binding: CsrfBinding): string {
    assertBinding(binding);
    const nonce = randomBytes(32).toString('base64url');
    const unsigned = `${this.current.id}.${nonce}`;
    return `${unsigned}.${sign(this.current.secret, binding, unsigned)}`;
  }

  verify(
    cookieValue: string,
    headerValue: string,
    binding: CsrfBinding,
  ): boolean {
    try {
      assertBinding(binding);
      if (
        !safeEqualText(cookieValue, headerValue) ||
        cookieValue.length > 256
      ) {
        return false;
      }
      const parts = cookieValue.split('.');
      if (
        parts.length !== 3 ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(parts[0] ?? '') ||
        !/^[A-Za-z0-9_-]{43}$/.test(parts[1] ?? '') ||
        !/^[A-Za-z0-9_-]{43}$/.test(parts[2] ?? '')
      ) {
        return false;
      }
      const key = [this.current, this.previous].find(
        (candidate) => candidate?.id === parts[0],
      );
      if (!key) return false;
      const unsigned = `${parts[0]}.${parts[1]}`;
      return safeEqualText(parts[2] ?? '', sign(key.secret, binding, unsigned));
    } catch {
      return false;
    }
  }
}

interface DecodedKey {
  readonly id: string;
  readonly secret: Buffer;
}

function decodeKey(key: VersionedSecret): DecodedKey {
  return { id: key.id, secret: Buffer.from(key.secret, 'base64url') };
}

function sign(secret: Buffer, binding: CsrfBinding, unsigned: string): string {
  return createHmac('sha256', secret)
    .update('cornerstone-csrf\0', 'utf8')
    .update(binding, 'utf8')
    .update('\0', 'utf8')
    .update(unsigned, 'utf8')
    .digest('base64url');
}

function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function assertBinding(binding: string): asserts binding is CsrfBinding {
  if (
    binding.length > 160 ||
    (!binding.startsWith('preauth:') && !binding.startsWith('session:')) ||
    binding.endsWith(':')
  ) {
    throw new TypeError('Invalid CSRF binding');
  }
}
