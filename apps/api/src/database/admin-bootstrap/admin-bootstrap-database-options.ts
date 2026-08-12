import type { DataSourceOptions } from 'typeorm';
import type { AdminBootstrapEnvironment } from './admin-bootstrap-environment.js';

export function buildAdminBootstrapDatabaseOptions(
  environment: Pick<
    AdminBootstrapEnvironment,
    | 'DATABASE_ADMIN_BOOTSTRAP_URL'
    | 'DATABASE_SSL_MODE'
    | 'DATABASE_SSL_CA'
    | 'DATABASE_CONNECT_TIMEOUT_MS'
    | 'DATABASE_STATEMENT_TIMEOUT_MS'
    | 'DATABASE_LOCK_TIMEOUT_MS'
    | 'DATABASE_IDLE_TRANSACTION_TIMEOUT_MS'
  >,
): DataSourceOptions {
  return {
    type: 'postgres',
    url: environment.DATABASE_ADMIN_BOOTSTRAP_URL,
    ssl:
      environment.DATABASE_SSL_MODE === 'verify-full'
        ? {
            rejectUnauthorized: true,
            ...(environment.DATABASE_SSL_CA
              ? { ca: environment.DATABASE_SSL_CA }
              : {}),
          }
        : false,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: {
      application_name: 'cornerstone-admin-bootstrap',
      statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
      lock_timeout: environment.DATABASE_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout:
        environment.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
    },
  };
}
