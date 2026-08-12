import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { buildDatabaseOptions } from './database-options.js';
import {
  cleanupExpiredOperationalData,
  retentionCategories,
} from './retention-cleanup.js';

const DEFAULT_BATCH_SIZE = 1_000;

async function run(): Promise<void> {
  const environment = validateDatabaseEnvironment(process.env);
  const source = new DataSource(
    buildDatabaseOptions(environment, 'maintenance'),
  );
  const batchSize = parseBatchSize(process.env.RETENTION_BATCH_SIZE);

  await source.initialize();
  try {
    const result = await cleanupExpiredOperationalData(source, { batchSize });
    const summary = retentionCategories
      .map((category) => `${category}=${result[category]}`)
      .join(' ');
    process.stdout.write(`Retention cleanup completed: ${summary}\n`);
  } finally {
    await source.destroy();
  }
}

function parseBatchSize(value: string | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_SIZE;
  if (!/^\d{1,4}$/.test(value)) {
    throw new Error('RETENTION_BATCH_SIZE must be an integer from 1 to 1000');
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > 1_000) {
    throw new Error('RETENTION_BATCH_SIZE must be an integer from 1 to 1000');
  }
  return parsed;
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Retention failed';
  process.stderr.write(`Retention cleanup failed: ${message}\n`);
  process.exitCode = 1;
});
