import type { DataSource } from 'typeorm';
import { readQueryRows } from './query-result.js';

export const retentionCategories = [
  'sessions',
  'actionTokens',
  'idempotency',
  'rateLimits',
  'outboxProcessed',
  'outboxPoison',
  'audit',
] as const;

export type RetentionCategory = (typeof retentionCategories)[number];
export type RetentionCleanupResult = Readonly<
  Record<RetentionCategory, number>
>;

export async function cleanupExpiredOperationalData(
  source: DataSource,
  input: { readonly batchSize: number; readonly now?: Date },
): Promise<RetentionCleanupResult> {
  validateBatchSize(input.batchSize);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Invalid retention time');

  const raw: unknown = await source.query(
    `SELECT category, deleted_count AS "deletedCount"
     FROM cornerstone_cleanup_retention($1, $2::timestamptz)`,
    [input.batchSize, now],
  );
  const rows = readQueryRows<{ category: string; deletedCount: number }>(raw);
  const result = Object.create(null) as Record<RetentionCategory, number>;
  for (const category of retentionCategories) {
    const matches = rows.filter((row) => row.category === category);
    const count = matches[0]?.deletedCount;
    if (
      matches.length !== 1 ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > input.batchSize
    ) {
      throw new Error(`Invalid retention result for ${category}`);
    }
    result[category] = count;
  }
  return result;
}

function validateBatchSize(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error('Retention batch size must be 1..1000');
  }
}
