import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { buildDatabaseOptions } from './database-options.js';
import { migrationDataSource } from './data-source.js';

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

    await runtimeDataSource.initialize();
    try {
      const runtimePrincipal = new URL(environment.DATABASE_URL).username;
      const forbiddenPrivileges = [
        ["has_schema_privilege($1, 'public', 'CREATE')", 'schema CREATE'],
        ["has_table_privilege($1, 'users', 'DELETE')", 'users DELETE'],
        ["has_table_privilege($1, 'audit_events', 'UPDATE')", 'audit UPDATE'],
        ["has_table_privilege($1, 'audit_events', 'DELETE')", 'audit DELETE'],
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
    } finally {
      await runtimeDataSource.destroy();
    }
  } finally {
    await migrationDataSource.destroy();
  }

  process.stdout.write('Database contract verification: OK\n');
}

void verify().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Verification failed';
  process.stderr.write(`Database verification failed: ${message}\n`);
  process.exitCode = 1;
});
