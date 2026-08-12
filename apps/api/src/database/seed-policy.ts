import type { DatabaseEnvironmentVariables } from '../config/env.schema.js';

export function assertSeedAllowed(
  environment: DatabaseEnvironmentVariables,
): void {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Seed is forbidden in production');
  }

  if (environment.NODE_ENV === 'test') {
    const databaseName = decodeURIComponent(
      new URL(environment.DATABASE_URL).pathname.slice(1),
    );
    if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
      throw new Error('Test seed requires a database name containing test');
    }
  }
}
