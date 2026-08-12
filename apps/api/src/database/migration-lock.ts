import { setTimeout as delay } from 'node:timers/promises';
import type { QueryRunner } from 'typeorm';

export const migrationAdvisoryLockName =
  'cornerstone:migration-runner:v1' as const;

export async function acquireMigrationLock(
  runner: QueryRunner,
  waitMs: number,
): Promise<void> {
  const deadline = Date.now() + waitMs;

  do {
    const result: unknown = await runner.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [migrationAdvisoryLockName],
    );

    if (
      Array.isArray(result) &&
      typeof result[0] === 'object' &&
      result[0] !== null &&
      Reflect.get(result[0], 'acquired') === true
    ) {
      return;
    }
    if (Date.now() >= deadline) break;
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  } while (Date.now() <= deadline);

  throw new Error('Another migration runner holds the advisory lock');
}

export async function releaseMigrationLock(runner: QueryRunner): Promise<void> {
  await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [
    migrationAdvisoryLockName,
  ]);
}
