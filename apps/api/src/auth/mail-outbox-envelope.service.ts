import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from 'node:crypto';
import { normalizeEmail } from '../identity/identity.contract.js';
import {
  AUTH_SECURITY_OPTIONS,
  type AuthSecurityOptions,
  type VersionedSecret,
} from './auth-security.options.js';

export type AuthMailPurpose = 'reset_password' | 'verify_email';

export interface AuthMailMessage {
  readonly purpose: AuthMailPurpose;
  readonly recipient: string;
  readonly actionValue: string;
}

export interface AuthMailEnvelopeContext {
  readonly userId: string;
  readonly purpose: AuthMailPurpose;
  readonly eventType: string;
  readonly eventVersion: 1;
}

export interface SealedMailEnvelope {
  readonly keyVersion: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

@Injectable()
export class MailOutboxEnvelopeService {
  private readonly current: DecodedKey;
  private readonly previous: DecodedKey | undefined;

  constructor(@Inject(AUTH_SECURITY_OPTIONS) options: AuthSecurityOptions) {
    this.current = decodeKey(options.mailOutbox.current);
    this.previous = options.mailOutbox.previous
      ? decodeKey(options.mailOutbox.previous)
      : undefined;
  }

  seal(
    message: AuthMailMessage,
    context: AuthMailEnvelopeContext,
  ): SealedMailEnvelope {
    validateMessage(message);
    validateContext(context);
    if (message.purpose !== context.purpose) {
      throw new TypeError('Mail message purpose does not match its context');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv(algorithm, this.current.secret, iv);
    cipher.setAAD(aad(this.current.id, context));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(message), 'utf8'),
      cipher.final(),
    ]);
    return {
      keyVersion: this.current.id,
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
  }

  open(
    envelope: SealedMailEnvelope,
    context: AuthMailEnvelopeContext,
  ): AuthMailMessage {
    validateEnvelope(envelope);
    validateContext(context);
    const key = [this.current, this.previous].find(
      (candidate) => candidate?.id === envelope.keyVersion,
    );
    if (!key) throw new Error('Unknown mail outbox key version');
    try {
      const decipher = createDecipheriv(
        algorithm,
        key.secret,
        canonicalBase64Url(envelope.iv, 12),
      );
      decipher.setAAD(aad(key.id, context));
      decipher.setAuthTag(canonicalBase64Url(envelope.tag, 16));
      const plaintext = Buffer.concat([
        decipher.update(
          canonicalBase64Url(envelope.ciphertext, undefined, 4096),
        ),
        decipher.final(),
      ]);
      if (plaintext.length > 4096)
        throw new Error('Mail envelope is too large');
      const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
      validateMessage(parsed);
      if (parsed.purpose !== context.purpose) {
        throw new Error('Mail message purpose does not match its context');
      }
      return parsed;
    } catch {
      throw new Error('Invalid mail outbox envelope');
    }
  }
}

const algorithm: CipherGCMTypes = 'aes-256-gcm';

interface DecodedKey {
  readonly id: string;
  readonly secret: Buffer;
}

function decodeKey(key: VersionedSecret): DecodedKey {
  const secret = Buffer.from(key.secret, 'base64url');
  if (secret.length !== 32) throw new Error('Mail outbox key must be 32 bytes');
  return { id: key.id, secret };
}

function aad(keyVersion: string, context: AuthMailEnvelopeContext): Buffer {
  return Buffer.from(
    [
      'cornerstone-auth-mail',
      keyVersion,
      context.eventType,
      String(context.eventVersion),
      context.userId,
      context.purpose,
    ].join('\0'),
    'utf8',
  );
}

function canonicalBase64Url(
  value: string,
  expectedLength?: number,
  maximumLength?: number,
): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength) ||
    (maximumLength !== undefined && decoded.length > maximumLength)
  ) {
    throw new Error('Invalid base64url size');
  }
  return decoded;
}

function validateEnvelope(value: SealedMailEnvelope): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.keyVersion) ||
    typeof value.iv !== 'string' ||
    typeof value.ciphertext !== 'string' ||
    typeof value.tag !== 'string'
  ) {
    throw new Error('Invalid mail outbox envelope');
  }
}

function validateMessage(value: unknown): asserts value is AuthMailMessage {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'actionValue,purpose,recipient'
  ) {
    throw new TypeError('Invalid auth mail message');
  }
  const record = value as Record<string, unknown>;
  const recipient = record.recipient;
  if (
    typeof record.purpose !== 'string' ||
    !['verify_email', 'reset_password'].includes(record.purpose) ||
    typeof recipient !== 'string' ||
    recipient.length > 254 ||
    typeof record.actionValue !== 'string' ||
    record.actionValue.length < 32 ||
    record.actionValue.length > 1024
  ) {
    throw new TypeError('Invalid auth mail message');
  }
  try {
    if (normalizeEmail(recipient) !== recipient) {
      throw new TypeError('Auth mail recipient must be normalized');
    }
  } catch {
    throw new TypeError('Invalid auth mail message');
  }
}

function validateContext(
  context: AuthMailEnvelopeContext,
): asserts context is AuthMailEnvelopeContext {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      context.userId,
    ) ||
    !['verify_email', 'reset_password'].includes(context.purpose) ||
    !/^[a-z][a-z0-9.]{2,127}$/.test(context.eventType) ||
    context.eventVersion !== 1
  ) {
    throw new TypeError('Invalid auth mail envelope context');
  }
}
