import { envSchema } from './env.schema.js';

export const configuration = () => {
  const environment = envSchema.parse(process.env);

  return {
    app: {
      environment: environment.NODE_ENV,
      port: environment.PORT,
      trustProxyHops: environment.TRUST_PROXY_HOPS,
      webUrl: environment.WEB_URL,
    },
    database: {
      url: environment.DATABASE_URL,
      migrationUrl: environment.DATABASE_MIGRATION_URL,
      sslMode: environment.DATABASE_SSL_MODE,
      sslCa: environment.DATABASE_SSL_CA,
      poolMax: environment.DATABASE_POOL_MAX,
      connectTimeoutMs: environment.DATABASE_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: environment.DATABASE_STATEMENT_TIMEOUT_MS,
      lockTimeoutMs: environment.DATABASE_LOCK_TIMEOUT_MS,
      idleTransactionTimeoutMs:
        environment.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
      migrationLockWaitMs: environment.MIGRATION_LOCK_WAIT_MS,
    },
    auth: {
      jwtAccessSecret: environment.JWT_ACCESS_SECRET,
      jwtRefreshSecret: environment.JWT_REFRESH_SECRET,
    },
  };
};
