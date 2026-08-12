import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { DataSource } from 'typeorm';
import { normalizeEmail } from '../../identity/identity.contract.js';
import { readQueryRows } from '../query-result.js';

export class AdminBootstrapError extends Error {
  constructor(readonly code: 'ADMIN_EXISTS' | 'BOOTSTRAP_FAILED') {
    super(code);
    this.name = 'AdminBootstrapError';
  }
}

export interface AdminBootstrapInput {
  readonly email: string;
  readonly password: Buffer;
  readonly requestId: string;
  readonly argon2: {
    readonly memoryCostKib: number;
    readonly timeCost: number;
    readonly parallelism: number;
  };
}

export interface AdminBootstrapResult {
  readonly userId: string;
  readonly auditId: string;
}

export async function bootstrapInitialAdmin(
  source: DataSource,
  input: AdminBootstrapInput,
): Promise<AdminBootstrapResult> {
  try {
    const email = assertNormalizedBootstrapEmail(input.email);
    assertPassword(input.password);
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: input.argon2.memoryCostKib,
      timeCost: input.argon2.timeCost,
      parallelism: input.argon2.parallelism,
      hashLength: 32,
    });
    const userId = randomUUID();
    const auditId = randomUUID();
    const result = await queryRows<AdminBootstrapResult>(
      source,
      `SELECT user_id AS "userId", audit_id AS "auditId" FROM public.cornerstone_bootstrap_initial_admin($1, $2, $3, $4, $5)`,
      [userId, auditId, email, passwordHash, input.requestId],
    );
    if (!result[0]) throw new AdminBootstrapError('BOOTSTRAP_FAILED');
    return result[0];
  } catch (error) {
    if (isBootstrapRejected(error))
      throw new AdminBootstrapError('ADMIN_EXISTS');
    if (error instanceof AdminBootstrapError) throw error;
    throw new AdminBootstrapError('BOOTSTRAP_FAILED');
  } finally {
    input.password.fill(0);
  }
}

export function assertNormalizedBootstrapEmail(value: string): string {
  const normalized = normalizeEmail(value);
  if (normalized !== value) throw new AdminBootstrapError('BOOTSTRAP_FAILED');
  return normalized;
}

function assertPassword(password: Buffer): void {
  const codePoints = password.reduce(
    (count, byte) => count + ((byte & 0xc0) === 0x80 ? 0 : 1),
    0,
  );
  if (codePoints < 12 || codePoints > 128 || password.length > 512) {
    throw new AdminBootstrapError('BOOTSTRAP_FAILED');
  }
}

async function queryRows<T extends object>(
  manager: { query(sql: string, parameters?: unknown[]): Promise<unknown> },
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<readonly T[]> {
  return readQueryRows<T>(await manager.query(sql, [...parameters]));
}

function isBootstrapRejected(error: unknown): boolean {
  const code: unknown =
    error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
  return typeof code === 'string' && /^CSB0[126]$/.test(code);
}
