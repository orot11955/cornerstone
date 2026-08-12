import { z } from 'zod';

const httpOrigin = z
  .string()
  .url()
  .refine(
    (value) => {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.pathname === '/' || url.pathname === '')
      );
    },
    {
      message:
        'WEB_URL must be an HTTP(S) origin without credentials, path, query, or hash',
    },
  );

const postgresUrl = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    const forbiddenParameters = [
      'application_name',
      'options',
      'sslcert',
      'sslkey',
      'sslmode',
      'sslrootcert',
    ];

    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      context.addIssue({
        code: 'custom',
        message: 'Database URL must use the postgres or postgresql protocol',
      });
    }

    if (!url.username || !url.hostname || url.pathname === '/') {
      context.addIssue({
        code: 'custom',
        message:
          'Database URL must include a username, host, and database name',
      });
    }

    if (url.hash) {
      context.addIssue({
        code: 'custom',
        message: 'Database URL must not include a fragment',
      });
    }

    if (
      forbiddenParameters.some((parameter) => url.searchParams.has(parameter))
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Database URL must not override TLS, application name, or connection options',
      });
    }
  });

const databaseEnvironmentShape = {
  DATABASE_URL: postgresUrl,
  DATABASE_MIGRATION_URL: postgresUrl.optional(),
  DATABASE_SSL_MODE: z.enum(['disable', 'verify-full']).default('disable'),
  DATABASE_SSL_CA: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(5_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(120_000)
    .default(30_000),
  DATABASE_LOCK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(5_000),
  DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(30_000),
  MIGRATION_LOCK_WAIT_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(60_000)
    .default(5_000),
};

function validateDatabasePolicy(
  environment: {
    NODE_ENV?: 'development' | 'test' | 'production' | undefined;
    DATABASE_URL: string;
    DATABASE_MIGRATION_URL?: string | undefined;
    DATABASE_SSL_MODE: 'disable' | 'verify-full';
  },
  context: z.RefinementCtx,
): void {
  if (
    environment.NODE_ENV === 'production' &&
    environment.DATABASE_SSL_MODE !== 'verify-full'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['DATABASE_SSL_MODE'],
      message: 'DATABASE_SSL_MODE must be verify-full in production',
    });
  }

  if (
    environment.NODE_ENV === 'production' &&
    environment.DATABASE_MIGRATION_URL &&
    new URL(environment.DATABASE_MIGRATION_URL).username ===
      new URL(environment.DATABASE_URL).username
  ) {
    context.addIssue({
      code: 'custom',
      path: ['DATABASE_MIGRATION_URL'],
      message:
        'Production runtime and migration database principals must be different',
    });
  }

  if (environment.DATABASE_MIGRATION_URL) {
    const runtime = new URL(environment.DATABASE_URL);
    const migration = new URL(environment.DATABASE_MIGRATION_URL);

    if (
      runtime.hostname !== migration.hostname ||
      runtime.port !== migration.port ||
      runtime.pathname !== migration.pathname
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_MIGRATION_URL'],
        message: 'Runtime and migration URLs must target the same database',
      });
    }
  }
}

export const databaseEnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    ...databaseEnvironmentShape,
  })
  .superRefine(validateDatabasePolicy);

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
    WEB_URL: httpOrigin,
    ...databaseEnvironmentShape,
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
  })
  .superRefine((environment, context) => {
    validateDatabasePolicy(environment, context);

    if (
      environment.NODE_ENV === 'production' &&
      new URL(environment.WEB_URL).protocol !== 'https:'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_URL'],
        message: 'WEB_URL must use HTTPS in production',
      });
    }
  });

export type EnvironmentVariables = z.infer<typeof envSchema>;
export type DatabaseEnvironmentVariables = z.infer<
  typeof databaseEnvironmentSchema
>;

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  return envSchema.parse(config);
}

export function validateDatabaseEnvironment(
  config: Record<string, unknown>,
): DatabaseEnvironmentVariables {
  return databaseEnvironmentSchema.parse(config);
}
