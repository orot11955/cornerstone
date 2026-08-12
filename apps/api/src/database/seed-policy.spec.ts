import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { assertSeedAllowed } from './seed-policy.js';

describe('assertSeedAllowed', () => {
  it('allows development and isolated test databases', () => {
    expect(() =>
      assertSeedAllowed(
        validateDatabaseEnvironment({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://app:app@localhost/cornerstone_dev',
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSeedAllowed(
        validateDatabaseEnvironment({
          NODE_ENV: 'test',
          DATABASE_URL: 'postgresql://app:app@localhost/cornerstone_test',
        }),
      ),
    ).not.toThrow();
  });

  it('rejects production and test commands pointed at a non-test database', () => {
    expect(() =>
      assertSeedAllowed(
        validateDatabaseEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://app:app@db.example.com/cornerstone',
          DATABASE_SSL_MODE: 'verify-full',
        }),
      ),
    ).toThrow('forbidden in production');
    expect(() =>
      assertSeedAllowed(
        validateDatabaseEnvironment({
          NODE_ENV: 'test',
          DATABASE_URL: 'postgresql://app:app@localhost/cornerstone_dev',
        }),
      ),
    ).toThrow('database name containing test');
  });
});
