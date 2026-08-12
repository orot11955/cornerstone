import {
  validateDatabaseEnvironment,
  validateEnvironment,
} from './env.schema.js';

const requiredEnvironment = {
  WEB_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnvironment', () => {
  it('applies defaults to optional environment values', () => {
    expect(validateEnvironment(requiredEnvironment)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
    });
  });

  it('rejects missing secrets', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        JWT_ACCESS_SECRET: undefined,
      }),
    ).toThrow();
  });

  it('rejects invalid ports', () => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, PORT: '70000' }),
    ).toThrow();
  });

  it('rejects a web URL that is not an exact HTTP origin', () => {
    for (const webUrl of [
      'javascript:alert(1)',
      'https://user@example.com',
      'https://example.com/path',
      'https://example.com?redirect=evil',
    ]) {
      expect(() =>
        validateEnvironment({ ...requiredEnvironment, WEB_URL: webUrl }),
      ).toThrow();
    }
  });

  it('requires an HTTPS web origin in production', () => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, NODE_ENV: 'production' }),
    ).toThrow();
  });

  it('requires verified database TLS and distinct production principals', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        WEB_URL: 'https://example.com',
      }),
    ).toThrow();

    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        WEB_URL: 'https://example.com',
        DATABASE_SSL_MODE: 'verify-full',
        DATABASE_MIGRATION_URL:
          'postgresql://app:migration@example.com:5432/app',
      }),
    ).toThrow();
  });

  it('validates the standalone database environment used by migration CLI', () => {
    expect(
      validateDatabaseEnvironment({
        DATABASE_URL: requiredEnvironment.DATABASE_URL,
      }),
    ).toMatchObject({
      NODE_ENV: 'development',
      DATABASE_SSL_MODE: 'disable',
      DATABASE_POOL_MAX: 20,
    });
  });

  it('rejects database URL policy overrides and a different migration target', () => {
    expect(() =>
      validateDatabaseEnvironment({
        DATABASE_URL: `${requiredEnvironment.DATABASE_URL}?sslmode=disable`,
      }),
    ).toThrow();

    expect(() =>
      validateDatabaseEnvironment({
        DATABASE_URL: requiredEnvironment.DATABASE_URL,
        DATABASE_MIGRATION_URL:
          'postgresql://migrator:migrator@localhost:5432/other',
      }),
    ).toThrow();
  });
});
