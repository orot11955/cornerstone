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
      accessToken: {
        issuer: 'cornerstone-api',
        audience: 'cornerstone-web',
        ttlSeconds: 600,
        clockToleranceSeconds: 30,
        current: {
          id: environment.JWT_ACCESS_KID,
          secret: environment.JWT_ACCESS_KEY,
        },
        previous:
          environment.JWT_ACCESS_PREVIOUS_KID &&
          environment.JWT_ACCESS_PREVIOUS_KEY
            ? {
                id: environment.JWT_ACCESS_PREVIOUS_KID,
                secret: environment.JWT_ACCESS_PREVIOUS_KEY,
              }
            : undefined,
      },
      refreshToken: {
        current: {
          id: environment.REFRESH_TOKEN_KEY_VERSION,
          secret: environment.REFRESH_TOKEN_PEPPER,
        },
        previous:
          environment.REFRESH_TOKEN_PREVIOUS_KEY_VERSION &&
          environment.REFRESH_TOKEN_PREVIOUS_PEPPER
            ? {
                id: environment.REFRESH_TOKEN_PREVIOUS_KEY_VERSION,
                secret: environment.REFRESH_TOKEN_PREVIOUS_PEPPER,
              }
            : undefined,
        idleTtlSeconds: 7 * 24 * 60 * 60,
        absoluteTtlSeconds: 30 * 24 * 60 * 60,
      },
      actionToken: {
        current: {
          id: environment.ACTION_TOKEN_KEY_VERSION,
          secret: environment.ACTION_TOKEN_PEPPER,
        },
        previous:
          environment.ACTION_TOKEN_PREVIOUS_KEY_VERSION &&
          environment.ACTION_TOKEN_PREVIOUS_PEPPER
            ? {
                id: environment.ACTION_TOKEN_PREVIOUS_KEY_VERSION,
                secret: environment.ACTION_TOKEN_PREVIOUS_PEPPER,
              }
            : undefined,
      },
      csrf: {
        current: {
          id: environment.CSRF_KEY_VERSION,
          secret: environment.CSRF_SECRET,
        },
        previous:
          environment.CSRF_PREVIOUS_KEY_VERSION &&
          environment.CSRF_PREVIOUS_SECRET
            ? {
                id: environment.CSRF_PREVIOUS_KEY_VERSION,
                secret: environment.CSRF_PREVIOUS_SECRET,
              }
            : undefined,
      },
      rateLimitSecret: environment.RATE_LIMIT_SECRET,
      secretProvenance: {
        provider: environment.AUTH_SECRET_PROVENANCE,
        reference: environment.AUTH_SECRET_PROVENANCE_REF,
      },
      password: {
        memoryCostKib: environment.ARGON2_MEMORY_KIB,
        timeCost: environment.ARGON2_TIME_COST,
        parallelism: environment.ARGON2_PARALLELISM,
        hashLength: 32,
        maxConcurrent: environment.ARGON2_MAX_CONCURRENT,
        maxQueue: environment.ARGON2_MAX_QUEUE,
      },
    },
  };
};
