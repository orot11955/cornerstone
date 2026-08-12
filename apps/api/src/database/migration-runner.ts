import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { migrationDataSource } from './data-source.js';

type MigrationCommand = 'show' | 'run' | 'revert';

const advisoryLockName = 'cornerstone:migration-runner:v1';

function parseCommand(value: string | undefined): MigrationCommand {
  if (value === 'show' || value === 'run' || value === 'revert') return value;
  throw new Error('Expected one of: show, run, revert');
}

async function acquireMigrationLock(waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;

  do {
    const rows: Array<{ acquired: boolean }> = await migrationDataSource.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [advisoryLockName],
    );

    if (rows[0]?.acquired) return;
    if (Date.now() >= deadline) break;
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  } while (Date.now() <= deadline);

  throw new Error('Another migration runner holds the advisory lock');
}

async function run(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const environment = validateDatabaseEnvironment(process.env);

  if (command === 'revert' && environment.NODE_ENV === 'production') {
    throw new Error('Migration revert is forbidden in production');
  }

  await migrationDataSource.initialize();

  try {
    await acquireMigrationLock(environment.MIGRATION_LOCK_WAIT_MS);

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
    await migrationDataSource.query('SELECT pg_advisory_unlock(hashtext($1))', [
      advisoryLockName,
    ]);
    await migrationDataSource.destroy();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Migration failed';
  process.stderr.write(`Migration command failed: ${message}\n`);
  process.exitCode = 1;
});
