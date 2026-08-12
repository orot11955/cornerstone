import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSourceOptions } from 'typeorm';
import type { DatabaseEnvironmentVariables } from '../config/env.schema.js';

export type DatabaseConnectionPurpose = 'runtime' | 'migration' | 'maintenance';

function selectDatabaseUrl(
  environment: DatabaseEnvironmentVariables,
  purpose: DatabaseConnectionPurpose,
): string {
  if (purpose === 'runtime') return environment.DATABASE_URL;

  if (purpose === 'maintenance') {
    if (environment.DATABASE_MAINTENANCE_URL) {
      return environment.DATABASE_MAINTENANCE_URL;
    }
    if (environment.NODE_ENV === 'production') {
      throw new Error(
        'DATABASE_MAINTENANCE_URL is required for production maintenance',
      );
    }
  }

  if (environment.DATABASE_MIGRATION_URL) {
    return environment.DATABASE_MIGRATION_URL;
  }

  if (environment.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_MIGRATION_URL is required for production migrations',
    );
  }

  return environment.DATABASE_URL;
}

export function buildDatabaseOptions(
  environment: DatabaseEnvironmentVariables,
  purpose: DatabaseConnectionPurpose,
): DataSourceOptions {
  const databaseDirectory = dirname(fileURLToPath(import.meta.url));
  const ssl =
    environment.DATABASE_SSL_MODE === 'verify-full'
      ? {
          rejectUnauthorized: true,
          ...(environment.DATABASE_SSL_CA
            ? { ca: environment.DATABASE_SSL_CA }
            : {}),
        }
      : false;

  return {
    type: 'postgres',
    url: selectDatabaseUrl(environment, purpose),
    ssl,
    entities: [join(databaseDirectory, '../**/*.entity.{js,ts}')],
    migrations: [join(databaseDirectory, 'migrations/*-*.{js,ts}')],
    migrationsTableName: 'cornerstone_migrations',
    synchronize: false,
    migrationsRun: false,
    logging: false,
    poolSize: environment.DATABASE_POOL_MAX,
    connectTimeoutMS: environment.DATABASE_CONNECT_TIMEOUT_MS,
    extra: {
      application_name: `cornerstone-api-${purpose}`,
      statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
      lock_timeout: environment.DATABASE_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout:
        environment.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
    },
  };
}
