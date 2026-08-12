import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { buildDatabaseOptions } from './database-options.js';
import { assertSeedAllowed } from './seed-policy.js';
import {
  developmentSeedUserId,
  seedDevelopmentReference,
} from './seeds/development.seed.js';

async function seed(): Promise<void> {
  const environment = validateDatabaseEnvironment(process.env);
  assertSeedAllowed(environment);
  const migrationDataSource = new DataSource(
    buildDatabaseOptions(environment, 'migration'),
  );

  await migrationDataSource.initialize();
  try {
    if (await migrationDataSource.showMigrations()) {
      throw new Error('Seed requires an up-to-date schema');
    }

    await migrationDataSource.transaction(seedDevelopmentReference);
    const result: unknown = await migrationDataSource.query(
      `SELECT count(*)::integer AS count
       FROM users
       WHERE id = $1 AND email_normalized = 'developer@example.invalid'
         AND status = 'pending_verification' AND role = 'user'
         AND password_hash IS NULL`,
      [developmentSeedUserId],
    );
    if (
      !Array.isArray(result) ||
      typeof result[0] !== 'object' ||
      result[0] === null ||
      Reflect.get(result[0], 'count') !== 1
    ) {
      throw new Error('Development seed verification failed');
    }
  } finally {
    await migrationDataSource.destroy();
  }

  process.stdout.write('Development seed verification: OK\n');
}

void seed().catch((error: unknown) => {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : 'Seed failed';
  process.stderr.write(`Seed failed: ${message}\n`);
  process.exitCode = 1;
});
