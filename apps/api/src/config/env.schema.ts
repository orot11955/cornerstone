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

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
    WEB_URL: httpOrigin,
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
  })
  .superRefine((environment, context) => {
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

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  return envSchema.parse(config);
}
