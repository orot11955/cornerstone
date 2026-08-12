import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { DataSource, type EntityManager } from 'typeorm';
import { readQueryRows } from '../database/query-result.js';
import { normalizeEmail } from '../identity/identity.contract.js';
import {
  AUTH_SECURITY_OPTIONS,
  type AuthSecurityOptions,
} from './auth-security.options.js';

export const authRateLimitPolicies = {
  registerAccount: policy('auth.register.account', 5, 15 * 60),
  registerIp: policy('auth.register.ip', 20, 15 * 60),
  loginAccount: policy('auth.login.account', 10, 15 * 60),
  loginIp: policy('auth.login.ip', 60, 15 * 60),
  verificationAccount: policy('auth.verification.account', 5, 60 * 60),
  verificationIp: policy('auth.verification.ip', 30, 60 * 60),
  recoveryAccount: policy('auth.recovery.account', 5, 60 * 60),
  recoveryIp: policy('auth.recovery.ip', 30, 60 * 60),
  refreshSession: policy('auth.refresh.session', 30, 60),
  refreshIp: policy('auth.refresh.ip', 120, 60),
  csrfIp: policy('auth.csrf.ip', 120, 60),
  sessionMutation: policy('auth.session.mutation', 30, 60),
} as const;

export type AuthRateLimitPolicy =
  (typeof authRateLimitPolicies)[keyof typeof authRateLimitPolicies];

export interface RateLimitSubject {
  readonly kind: 'account' | 'ip' | 'session';
  readonly value: string;
  readonly policy: AuthRateLimitPolicy;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

@Injectable()
export class AuthRateLimitService {
  private readonly secret: Buffer;

  constructor(
    private readonly source: DataSource,
    @Inject(AUTH_SECURITY_OPTIONS) options: AuthSecurityOptions,
  ) {
    this.secret = Buffer.from(options.rateLimitSecret, 'base64url');
  }

  async consume(
    subjects: readonly RateLimitSubject[],
  ): Promise<RateLimitDecision> {
    if (subjects.length < 1 || subjects.length > 10) {
      throw new TypeError('Rate limit subject count must be 1..10');
    }
    if (
      subjects.some((subject) => subject.kind === 'account') &&
      !subjects.some(
        (subject) => subject.kind === 'ip' || subject.kind === 'session',
      )
    ) {
      throw new TypeError(
        'Account rate limit requires an IP or session admission subject',
      );
    }
    const prepared = subjects
      .map((subject) => this.prepare(subject))
      .sort(
        (left, right) =>
          left.priority - right.priority ||
          left.lockKey.localeCompare(right.lockKey),
      );
    if (
      new Set(prepared.map((subject) => subject.lockKey)).size !==
      prepared.length
    ) {
      throw new TypeError('Duplicate rate limit subject');
    }
    const decisions = await this.source.transaction(async (manager) => {
      const results: RateLimitDecision[] = [];
      for (const subject of prepared) {
        const decision = await this.consumeOne(manager, subject);
        results.push(decision);
        if (!decision.allowed) break;
      }
      return results;
    });
    const denied = decisions.filter((decision) => !decision.allowed);
    return denied.length === 0
      ? { allowed: true, retryAfterSeconds: 0 }
      : {
          allowed: false,
          retryAfterSeconds: Math.max(
            ...denied.map((decision) => decision.retryAfterSeconds),
          ),
        };
  }

  private async consumeOne(
    manager: EntityManager,
    subject: PreparedRateLimitSubject,
  ): Promise<RateLimitDecision> {
    const rows = readQueryRows<{ count: number; retryAfterSeconds: number }>(
      await manager.query(
        `WITH bucket AS (
           SELECT to_timestamp(
             floor(extract(epoch FROM CURRENT_TIMESTAMP) / $4::integer) * $4::integer
           ) AS window_start
         )
         INSERT INTO rate_limit_buckets (
           id, subject_hash, policy_id, window_start, count, expires_at,
           created_at, updated_at
         )
         SELECT $1, $2, $3, bucket.window_start, 1,
           bucket.window_start + ($4::integer * 2 * interval '1 second'),
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         FROM bucket
         ON CONFLICT (subject_hash, policy_id, window_start)
         DO UPDATE SET count = LEAST(rate_limit_buckets.count + 1, $5 + 1),
           updated_at = CURRENT_TIMESTAMP
         RETURNING count,
           GREATEST(
             1,
             ceil(extract(epoch FROM (window_start + ($4::integer * interval '1 second') - CURRENT_TIMESTAMP)))
           )::integer AS "retryAfterSeconds"`,
        [
          randomUUID(),
          subject.subjectHash,
          subject.policy.id,
          subject.policy.windowSeconds,
          subject.policy.limit,
        ],
      ),
    );
    const row = rows[0];
    if (!row) throw new Error('Rate limit bucket update returned no row');
    return {
      allowed: row.count <= subject.policy.limit,
      retryAfterSeconds:
        row.count <= subject.policy.limit ? 0 : row.retryAfterSeconds,
    };
  }

  private prepare(subject: RateLimitSubject): PreparedRateLimitSubject {
    validateSubject(subject);
    const canonicalValue = canonicalSubjectValue(subject);
    const subjectHash = createHmac('sha256', this.secret)
      .update('cornerstone-rate-limit\0', 'utf8')
      .update(subject.kind, 'utf8')
      .update('\0', 'utf8')
      .update(canonicalValue, 'utf8')
      .digest('hex');
    return {
      policy: subject.policy,
      subjectHash,
      priority: subject.kind === 'account' ? 1 : 0,
      lockKey: `${subject.policy.id}:${subjectHash}`,
    };
  }
}

interface PreparedRateLimitSubject {
  readonly policy: AuthRateLimitPolicy;
  readonly subjectHash: string;
  readonly priority: number;
  readonly lockKey: string;
}

function policy(id: string, limit: number, windowSeconds: number) {
  return Object.freeze({ id, limit, windowSeconds });
}

function validateSubject(subject: RateLimitSubject): void {
  const approved = Object.values(authRateLimitPolicies).find(
    (policy) => policy.id === subject.policy.id,
  );
  if (
    !['account', 'ip', 'session'].includes(subject.kind) ||
    subject.value.length < 1 ||
    subject.value.length > 512 ||
    !/^[a-z][a-z0-9.]{2,63}$/.test(subject.policy.id) ||
    !Number.isInteger(subject.policy.limit) ||
    subject.policy.limit < 1 ||
    subject.policy.limit > 10_000 ||
    !Number.isInteger(subject.policy.windowSeconds) ||
    subject.policy.windowSeconds < 1 ||
    subject.policy.windowSeconds > 86_400 ||
    approved?.limit !== subject.policy.limit ||
    approved?.windowSeconds !== subject.policy.windowSeconds ||
    !subject.policy.id.endsWith(`.${subject.kind}`)
  ) {
    throw new TypeError('Invalid rate limit subject or policy');
  }
}

function canonicalSubjectValue(subject: RateLimitSubject): string {
  if (subject.kind === 'account') return normalizeEmail(subject.value);
  if (subject.kind === 'session') {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        subject.value,
      )
    ) {
      throw new TypeError('Rate limit session subject must be UUID v4');
    }
    return subject.value.toLowerCase();
  }
  return canonicalIp(subject.value);
}

function canonicalIp(value: string): string {
  const version = isIP(value);
  if (version === 0) throw new TypeError('Rate limit IP subject is invalid');
  if (version === 4) return value.split('.').map(Number).join('.');
  const hostname = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname);
  if (!mapped) return hostname;
  const high = Number.parseInt(mapped[1]!, 16);
  const low = Number.parseInt(mapped[2]!, 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}
