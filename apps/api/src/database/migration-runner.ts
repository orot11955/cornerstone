import 'dotenv/config';
import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { migrationDataSource } from './data-source.js';
import {
  acquireMigrationLock,
  releaseMigrationLock,
} from './migration-lock.js';

type MigrationCommand = 'show' | 'run' | 'revert';

function parseCommand(value: string | undefined): MigrationCommand {
  if (value === 'show' || value === 'run' || value === 'revert') return value;
  throw new Error('Expected one of: show, run, revert');
}

async function run(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const environment = validateDatabaseEnvironment(process.env);

  if (command === 'revert' && environment.NODE_ENV === 'production') {
    throw new Error('Migration revert is forbidden in production');
  }

  await migrationDataSource.initialize();
  const lockRunner = migrationDataSource.createQueryRunner();
  await lockRunner.connect();

  try {
    await acquireMigrationLock(lockRunner, environment.MIGRATION_LOCK_WAIT_MS);

    if (command === 'show') {
      const pending = await migrationDataSource.showMigrations();
      process.stdout.write(
        pending ? 'Pending migrations exist.\n' : 'No pending migrations.\n',
      );
      return;
    }

    if (command === 'run') {
      const migrations = await migrationDataSource.runMigrations({
        transaction: 'each',
      });
      process.stdout.write(`Applied ${migrations.length} migration(s).\n`);
      return;
    }

    await migrationDataSource.undoLastMigration({ transaction: 'each' });
    process.stdout.write('Reverted the latest migration.\n');
  } finally {
    await releaseMigrationLock(lockRunner);
    await lockRunner.release();
    await migrationDataSource.destroy();
  }
}

void run().catch((error: unknown) => {
  const message = safeErrorMessage(error, 'Migration failed');
  process.stderr.write(`Migration command failed: ${message}\n`);
  process.exitCode = 1;
});

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error.message.trim()) return error.message;
  const code = Reflect.get(error, 'code') as unknown;
  return typeof code === 'string' ? `${error.name} (${code})` : error.name;
}
