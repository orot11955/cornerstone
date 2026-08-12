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
  DATABASE_MAINTENANCE_URL: postgresUrl.optional(),
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

const base64UrlSecret = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'Secret must be unpadded base64url')
  .superRefine((value, context) => {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length < 32) {
      context.addIssue({
        code: 'custom',
        message: 'Secret must decode to at least 32 bytes',
      });
    }
    if (decoded.toString('base64url') !== value) {
      context.addIssue({
        code: 'custom',
        message: 'Secret must use canonical unpadded base64url encoding',
      });
    }
  });

const base64UrlKey32 = base64UrlSecret.superRefine((value, context) => {
  if (Buffer.from(value, 'base64url').length !== 32) {
    context.addIssue({
      code: 'custom',
      message: 'Encryption key must decode to exactly 32 bytes',
    });
  }
});

const keyId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);

const authEnvironmentShape = {
  JWT_ACCESS_KID: keyId,
  JWT_ACCESS_KEY: base64UrlSecret,
  JWT_ACCESS_PREVIOUS_KID: keyId.optional(),
  JWT_ACCESS_PREVIOUS_KEY: base64UrlSecret.optional(),
  REFRESH_TOKEN_KEY_VERSION: keyId,
  REFRESH_TOKEN_PEPPER: base64UrlSecret,
  REFRESH_TOKEN_PREVIOUS_KEY_VERSION: keyId.optional(),
  REFRESH_TOKEN_PREVIOUS_PEPPER: base64UrlSecret.optional(),
  ACTION_TOKEN_KEY_VERSION: keyId,
  ACTION_TOKEN_PEPPER: base64UrlSecret,
  ACTION_TOKEN_PREVIOUS_KEY_VERSION: keyId.optional(),
  ACTION_TOKEN_PREVIOUS_PEPPER: base64UrlSecret.optional(),
  CSRF_KEY_VERSION: keyId,
  CSRF_SECRET: base64UrlSecret,
  CSRF_PREVIOUS_KEY_VERSION: keyId.optional(),
  CSRF_PREVIOUS_SECRET: base64UrlSecret.optional(),
  RATE_LIMIT_SECRET: base64UrlSecret,
  IDEMPOTENCY_SECRET: base64UrlSecret,
  MAIL_OUTBOX_KEY_VERSION: keyId,
  MAIL_OUTBOX_KEY: base64UrlKey32,
  MAIL_OUTBOX_PREVIOUS_KEY_VERSION: keyId.optional(),
  MAIL_OUTBOX_PREVIOUS_KEY: base64UrlKey32.optional(),
  AUTH_SECRET_PROVENANCE: z
    .enum([
      'local',
      'aws-secrets-manager',
      'gcp-secret-manager',
      'azure-key-vault',
      'vault',
      'kubernetes-secret',
      'container-secret',
    ])
    .default('local'),
  AUTH_SECRET_PROVENANCE_REF: z
    .string()
    .min(3)
    .max(255)
    .regex(/^\S+$/)
    .optional(),
  ARGON2_MEMORY_KIB: z.coerce
    .number()
    .int()
    .min(19_456)
    .max(262_144)
    .default(65_536),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).max(5).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(4).default(1),
  ARGON2_MAX_CONCURRENT: z.coerce.number().int().min(1).max(8).default(2),
  ARGON2_MAX_QUEUE: z.coerce.number().int().min(0).max(1_000).default(100),
};

const knownDevelopmentSecrets = new Set(
  [
    'cornerstone-local-access-key-v1-32-bytes',
    'cornerstone-local-refresh-key-v1-32-bytes',
    'cornerstone-local-action-key-v1-32-bytes',
    'cornerstone-local-csrf-key-v1-32-bytes',
    'cornerstone-local-rate-key-v1-32-bytes',
    'cornerstone-local-idempotency-key-v1-32-bytes',
    'cornerstone-local-mail-key-v1-32',
  ].map((value) => Buffer.from(value).toString('hex')),
);

function validateOptionalKeyPair(
  environment: Record<string, unknown>,
  idName: string,
  secretName: string,
  context: z.RefinementCtx,
): void {
  if (Boolean(environment[idName]) !== Boolean(environment[secretName])) {
    context.addIssue({
      code: 'custom',
      path: [environment[idName] ? secretName : idName],
      message: `${idName} and ${secretName} must be configured together`,
    });
  }
}

function validateAuthPolicy(
  environment: Record<string, unknown> & {
    NODE_ENV?: 'development' | 'test' | 'production';
  },
  context: z.RefinementCtx,
): void {
  const pairs = [
    ['JWT_ACCESS_PREVIOUS_KID', 'JWT_ACCESS_PREVIOUS_KEY'],
    ['REFRESH_TOKEN_PREVIOUS_KEY_VERSION', 'REFRESH_TOKEN_PREVIOUS_PEPPER'],
    ['ACTION_TOKEN_PREVIOUS_KEY_VERSION', 'ACTION_TOKEN_PREVIOUS_PEPPER'],
    ['CSRF_PREVIOUS_KEY_VERSION', 'CSRF_PREVIOUS_SECRET'],
    ['MAIL_OUTBOX_PREVIOUS_KEY_VERSION', 'MAIL_OUTBOX_PREVIOUS_KEY'],
  ] as const;
  for (const [idName, secretName] of pairs) {
    validateOptionalKeyPair(environment, idName, secretName, context);
  }

  const versionPairs = [
    ['JWT_ACCESS_KID', 'JWT_ACCESS_PREVIOUS_KID'],
    ['REFRESH_TOKEN_KEY_VERSION', 'REFRESH_TOKEN_PREVIOUS_KEY_VERSION'],
    ['ACTION_TOKEN_KEY_VERSION', 'ACTION_TOKEN_PREVIOUS_KEY_VERSION'],
    ['CSRF_KEY_VERSION', 'CSRF_PREVIOUS_KEY_VERSION'],
    ['MAIL_OUTBOX_KEY_VERSION', 'MAIL_OUTBOX_PREVIOUS_KEY_VERSION'],
  ] as const;
  for (const [currentName, previousName] of versionPairs) {
    if (
      environment[previousName] &&
      environment[currentName] === environment[previousName]
    ) {
      context.addIssue({
        code: 'custom',
        path: [previousName],
        message: 'Current and previous key versions must be different',
      });
    }
  }

  const secretNames = [
    'JWT_ACCESS_KEY',
    'JWT_ACCESS_PREVIOUS_KEY',
    'REFRESH_TOKEN_PEPPER',
    'REFRESH_TOKEN_PREVIOUS_PEPPER',
    'ACTION_TOKEN_PEPPER',
    'ACTION_TOKEN_PREVIOUS_PEPPER',
    'CSRF_SECRET',
    'CSRF_PREVIOUS_SECRET',
    'RATE_LIMIT_SECRET',
    'IDEMPOTENCY_SECRET',
    'MAIL_OUTBOX_KEY',
    'MAIL_OUTBOX_PREVIOUS_KEY',
  ] as const;
  const seenSecrets = new Map<string, string>();
  for (const secretName of secretNames) {
    const value = environment[secretName];
    if (typeof value !== 'string') continue;
    const fingerprint = Buffer.from(value, 'base64url').toString('hex');
    const duplicate = seenSecrets.get(fingerprint);
    if (duplicate) {
      context.addIssue({
        code: 'custom',
        path: [secretName],
        message: `${secretName} must be different from ${duplicate}`,
      });
    } else {
      seenSecrets.set(fingerprint, secretName);
    }

    const decoded = Buffer.from(value, 'base64url');
    if (
      environment.NODE_ENV === 'production' &&
      (knownDevelopmentSecrets.has(fingerprint) ||
        /change|example|placeholder|default|local|development|test/i.test(
          decoded.toString('utf8'),
        ) ||
        [...decoded].every((byte) => byte >= 0x20 && byte <= 0x7e) ||
        estimatedEntropy(decoded) < 3.5)
    ) {
      context.addIssue({
        code: 'custom',
        path: [secretName],
        message: 'Production auth secrets must not be placeholders',
      });
    }
  }

  if (environment.NODE_ENV === 'production') {
    if (environment.AUTH_SECRET_PROVENANCE === 'local') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET_PROVENANCE'],
        message: 'Production auth secrets require an approved provenance',
      });
    }
    const provenanceReference = environment.AUTH_SECRET_PROVENANCE_REF;
    if (typeof provenanceReference !== 'string') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET_PROVENANCE_REF'],
        message: 'Production auth secrets require provenance metadata',
      });
    } else if (
      !isMatchingProvenanceReference(
        environment.AUTH_SECRET_PROVENANCE,
        provenanceReference,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET_PROVENANCE_REF'],
        message: 'Auth secret provenance reference does not match its provider',
      });
    }
  }
}

function estimatedEntropy(value: Buffer): number {
  const counts = new Map<number, number>();
  for (const byte of value) counts.set(byte, (counts.get(byte) ?? 0) + 1);
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

function isMatchingProvenanceReference(
  provider: unknown,
  reference: string,
): boolean {
  const prefixes: Readonly<Record<string, readonly string[]>> = {
    'aws-secrets-manager': ['arn:aws:secretsmanager:'],
    'gcp-secret-manager': ['projects/'],
    'azure-key-vault': ['https://'],
    vault: ['vault://'],
    'kubernetes-secret': ['k8s://'],
    'container-secret': ['file:///run/secrets/'],
  };
  return (prefixes[String(provider)] ?? []).some((prefix) =>
    reference.startsWith(prefix),
  );
}

function validateDatabasePolicy(
  environment: {
    NODE_ENV?: 'development' | 'test' | 'production' | undefined;
    DATABASE_URL: string;
    DATABASE_MIGRATION_URL?: string | undefined;
    DATABASE_MAINTENANCE_URL?: string | undefined;
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

  if (environment.DATABASE_MAINTENANCE_URL) {
    const runtime = new URL(environment.DATABASE_URL);
    const maintenance = new URL(environment.DATABASE_MAINTENANCE_URL);
    const migration = environment.DATABASE_MIGRATION_URL
      ? new URL(environment.DATABASE_MIGRATION_URL)
      : undefined;

    if (
      runtime.hostname !== maintenance.hostname ||
      runtime.port !== maintenance.port ||
      runtime.pathname !== maintenance.pathname
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_MAINTENANCE_URL'],
        message: 'Runtime and maintenance URLs must target the same database',
      });
    }

    if (
      environment.NODE_ENV === 'production' &&
      (maintenance.username === runtime.username ||
        maintenance.username === migration?.username)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_MAINTENANCE_URL'],
        message:
          'Production maintenance, runtime, and migration database principals must be different',
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
    ...authEnvironmentShape,
  })
  .superRefine((environment, context) => {
    validateDatabasePolicy(environment, context);
    validateAuthPolicy(environment, context);

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
