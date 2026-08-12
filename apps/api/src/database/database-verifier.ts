import 'dotenv/config';
import { DataSource, type QueryRunner } from 'typeorm';
import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { buildDatabaseOptions } from './database-options.js';
import { migrationDataSource } from './data-source.js';
import {
  acquireMigrationLock,
  releaseMigrationLock,
} from './migration-lock.js';

interface ScalarRow {
  readonly value: boolean | number | string;
}

const expectedTables = [
  'audit_events',
  'auth_action_tokens',
  'auth_refresh_tokens',
  'auth_sessions',
  'idempotency_records',
  'outbox_events',
  'rate_limit_buckets',
  'users',
] as const;

async function scalar(
  source: DataSource,
  query: string,
  parameters: readonly unknown[] = [],
): Promise<ScalarRow['value']> {
  const rows: ScalarRow[] = await source.query(query, [...parameters]);
  const value = rows[0]?.value;
  if (value === undefined)
    throw new Error('Database verification returned no row');
  return value;
}

async function verify(): Promise<void> {
  const environment = validateDatabaseEnvironment(process.env);
  const runtimeDataSource = new DataSource(
    buildDatabaseOptions(environment, 'runtime'),
  );
  const maintenanceDataSource = environment.DATABASE_MAINTENANCE_URL
    ? new DataSource(buildDatabaseOptions(environment, 'maintenance'))
    : undefined;

  await migrationDataSource.initialize();
  try {
    const version = Number(
      await scalar(
        migrationDataSource,
        "SELECT current_setting('server_version_num')::integer AS value",
      ),
    );
    if (version < 170_000 || version >= 180_000) {
      throw new Error('PostgreSQL 17.x is required');
    }

    if (await migrationDataSource.showMigrations()) {
      throw new Error('Pending migrations exist');
    }

    const tables = await scalar(
      migrationDataSource,
      `SELECT array_agg(table_name ORDER BY table_name)::text AS value
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name <> 'cornerstone_migrations'`,
    );
    if (tables !== `{${expectedTables.join(',')}}`) {
      throw new Error('Public table set does not match the Identity contract');
    }

    const forbiddenColumns = Number(
      await scalar(
        migrationDataSource,
        `SELECT count(*)::integer AS value
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (column_name = 'tenant_id' OR table_name ILIKE '%membership%')`,
      ),
    );
    if (forbiddenColumns !== 0) {
      throw new Error(
        'Single-tenant Core contains tenant or membership schema',
      );
    }

    const schemaDiff = await migrationDataSource.driver
      .createSchemaBuilder()
      .log();
    if (schemaDiff.upQueries.length !== 0) {
      throw new Error(
        `Entity/Migration schema drift detected (${schemaDiff.upQueries.length} queries)`,
      );
    }

    const lockContender = new DataSource(
      buildDatabaseOptions(environment, 'migration'),
    );
    await lockContender.initialize();
    const lockHolderRunner = migrationDataSource.createQueryRunner();
    const lockContenderRunner = lockContender.createQueryRunner();
    await lockHolderRunner.connect();
    await lockContenderRunner.connect();
    try {
      await acquireMigrationLock(lockHolderRunner, 0);
      await expectLockContention(lockContenderRunner);
    } finally {
      await releaseMigrationLock(lockHolderRunner);
      await lockHolderRunner.release();
      await lockContenderRunner.release();
      await lockContender.destroy();
    }

    await runtimeDataSource.initialize();
    try {
      const runtimePrincipal = new URL(environment.DATABASE_URL).username;
      const forbiddenPrivileges = [
        ["has_schema_privilege($1, 'public', 'CREATE')", 'schema CREATE'],
        ["has_table_privilege($1, 'users', 'DELETE')", 'users DELETE'],
        ["has_table_privilege($1, 'audit_events', 'UPDATE')", 'audit UPDATE'],
        ["has_table_privilege($1, 'audit_events', 'DELETE')", 'audit DELETE'],
        ["has_table_privilege($1, 'audit_events', 'SELECT')", 'audit SELECT'],
        [
          `has_function_privilege(
             $1,
             'cornerstone_cleanup_retention(integer,timestamp with time zone)',
             'EXECUTE'
           )`,
          'retention function EXECUTE',
        ],
        [
          "has_table_privilege($1, 'cornerstone_migrations', 'UPDATE')",
          'migration UPDATE',
        ],
      ] as const;

      for (const [expression, label] of forbiddenPrivileges) {
        if (
          await scalar(migrationDataSource, `SELECT ${expression} AS value`, [
            runtimePrincipal,
          ])
        ) {
          throw new Error(`Runtime principal unexpectedly has ${label}`);
        }
      }

      if (
        !(await scalar(
          runtimeDataSource,
          "SELECT has_table_privilege(current_user, 'users', 'SELECT,INSERT,UPDATE') AS value",
        ))
      ) {
        throw new Error(
          'Runtime principal is missing required users DML privileges',
        );
      }
      if (
        !(await scalar(
          runtimeDataSource,
          "SELECT has_table_privilege(current_user, 'cornerstone_migrations', 'SELECT') AS value",
        ))
      ) {
        throw new Error(
          'Runtime principal cannot inspect migration compatibility',
        );
      }
    } finally {
      await runtimeDataSource.destroy();
    }

    if (maintenanceDataSource) {
      await maintenanceDataSource.initialize();
      try {
        const allowed = await scalar(
          maintenanceDataSource,
          `SELECT has_function_privilege(
             current_user,
             'cornerstone_cleanup_retention(integer,timestamp with time zone)',
             'EXECUTE'
           ) AS value`,
        );
        if (!allowed) {
          throw new Error(
            'Maintenance principal cannot execute bounded retention cleanup',
          );
        }
        const forbidden = [
          ["has_schema_privilege(current_user, 'public', 'CREATE')", 'DDL'],
          [
            "has_table_privilege(current_user, 'users', 'DELETE')",
            'user DELETE',
          ],
          [
            "has_table_privilege(current_user, 'audit_events', 'SELECT')",
            'audit SELECT',
          ],
          [
            "has_table_privilege(current_user, 'audit_events', 'DELETE')",
            'audit DELETE',
          ],
          [
            "has_table_privilege(current_user, 'audit_events', 'INSERT')",
            'audit INSERT',
          ],
          [
            "has_table_privilege(current_user, 'audit_events', 'UPDATE')",
            'audit UPDATE',
          ],
        ] as const;
        for (const [expression, label] of forbidden) {
          if (
            await scalar(maintenanceDataSource, `SELECT ${expression} AS value`)
          ) {
            throw new Error(`Maintenance principal unexpectedly has ${label}`);
          }
        }
      } finally {
        await maintenanceDataSource.destroy();
      }
    }
  } finally {
    await migrationDataSource.destroy();
  }

  process.stdout.write('Database contract verification: OK\n');
}

async function expectLockContention(runner: QueryRunner): Promise<void> {
  try {
    await acquireMigrationLock(runner, 50);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === 'Another migration runner holds the advisory lock'
    ) {
      return;
    }
    throw error;
  }

  await releaseMigrationLock(runner);
  throw new Error('Concurrent migration advisory lock was not rejected');
}

void verify().catch((error: unknown) => {
  const message = safeErrorMessage(error, 'Verification failed');
  process.stderr.write(`Database verification failed: ${message}\n`);
  process.exitCode = 1;
});

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error.message.trim()) return error.message;
  const code = Reflect.get(error, 'code') as unknown;
  return typeof code === 'string' ? `${error.name} (${code})` : error.name;
}
