import { z } from 'zod';

const databaseUrl = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.username ||
      !url.hostname ||
      url.pathname === '/'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid bootstrap database URL',
      });
    }
    if (url.hash || url.search) {
      context.addIssue({
        code: 'custom',
        message: 'Bootstrap database URL must not contain query or fragment',
      });
    }
  });

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_ADMIN_BOOTSTRAP_URL: databaseUrl,
    DATABASE_SSL_MODE: z.enum(['disable', 'verify-full']).default('disable'),
    DATABASE_SSL_CA: z.string().min(1).optional(),
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
    ADMIN_BOOTSTRAP_EMAIL: z.string().min(3).max(254),
    ADMIN_BOOTSTRAP_PASSWORD_FILE: z.string().min(1).max(4_096).optional(),
    ADMIN_BOOTSTRAP_REQUEST_ID: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
    ARGON2_MEMORY_KIB: z.coerce
      .number()
      .int()
      .min(19_456)
      .max(262_144)
      .default(65_536),
    ARGON2_TIME_COST: z.coerce.number().int().min(2).max(5).default(3),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(4).default(1),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === 'production' &&
      environment.DATABASE_SSL_MODE !== 'verify-full'
    )
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_SSL_MODE'],
        message: 'Production bootstrap requires verify-full TLS',
      });
    if (
      environment.NODE_ENV === 'production' &&
      !environment.ADMIN_BOOTSTRAP_PASSWORD_FILE
    )
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_BOOTSTRAP_PASSWORD_FILE'],
        message: 'Production bootstrap requires a password file',
      });
  });

export type AdminBootstrapEnvironment = z.infer<typeof schema>;
export function validateAdminBootstrapEnvironment(
  value: Record<string, unknown>,
): AdminBootstrapEnvironment {
  return schema.parse(value);
}
