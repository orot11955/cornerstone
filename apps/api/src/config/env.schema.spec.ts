import { randomBytes } from 'node:crypto';
import {
  validateDatabaseEnvironment,
  validateEnvironment,
} from './env.schema.js';

const requiredEnvironment = {
  WEB_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  JWT_ACCESS_KID: 'test-access-v1',
  JWT_ACCESS_KEY: secret('test-access'),
  REFRESH_TOKEN_KEY_VERSION: 'test-refresh-v1',
  REFRESH_TOKEN_PEPPER: secret('test-refresh'),
  ACTION_TOKEN_KEY_VERSION: 'test-action-v1',
  ACTION_TOKEN_PEPPER: secret('test-action'),
  CSRF_KEY_VERSION: 'test-csrf-v1',
  CSRF_SECRET: secret('test-csrf'),
  RATE_LIMIT_SECRET: secret('test-rate-limit'),
  IDEMPOTENCY_SECRET: secret('test-idempotency'),
  MAIL_OUTBOX_KEY_VERSION: 'test-mail-v1',
  MAIL_OUTBOX_KEY: exactSecret('test-mail'),
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
        JWT_ACCESS_KEY: undefined,
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

  it('rejects short, equal, incomplete, or placeholder auth keys', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        JWT_ACCESS_KEY: Buffer.from('too-short').toString('base64url'),
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        CSRF_SECRET: requiredEnvironment.JWT_ACCESS_KEY,
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        JWT_ACCESS_PREVIOUS_KID: 'old-access',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        REFRESH_TOKEN_KEY_VERSION: 'refresh.v2',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        WEB_URL: 'https://example.com',
        DATABASE_SSL_MODE: 'verify-full',
        JWT_ACCESS_KEY: Buffer.from(
          'access-current-key-material-at-least-32-bytes',
        ).toString('base64url'),
        REFRESH_TOKEN_PEPPER: productionSecret(),
        ACTION_TOKEN_PEPPER: productionSecret(),
        CSRF_SECRET: productionSecret(),
        RATE_LIMIT_SECRET: productionSecret(),
        IDEMPOTENCY_SECRET: productionSecret(),
        MAIL_OUTBOX_KEY: productionSecret(),
        AUTH_SECRET_PROVENANCE: 'vault',
        AUTH_SECRET_PROVENANCE_REF: 'vault://secret/auth/cornerstone/v1',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        WEB_URL: 'https://example.com',
        DATABASE_SSL_MODE: 'verify-full',
        AUTH_SECRET_PROVENANCE: 'vault',
        AUTH_SECRET_PROVENANCE_REF: 'vault://secret/auth/cornerstone/v1',
      }),
    ).toThrow();
  });

  it('accepts approved production key provenance and distinct principals', () => {
    expect(
      validateEnvironment({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        WEB_URL: 'https://example.com',
        DATABASE_URL: 'postgresql://runtime:runtime@db.example.com/cornerstone',
        DATABASE_MIGRATION_URL:
          'postgresql://migration:migration@db.example.com/cornerstone',
        DATABASE_MAINTENANCE_URL:
          'postgresql://maintenance:maintenance@db.example.com/cornerstone',
        DATABASE_SSL_MODE: 'verify-full',
        JWT_ACCESS_KEY: productionSecret(),
        REFRESH_TOKEN_PEPPER: productionSecret(),
        ACTION_TOKEN_PEPPER: productionSecret(),
        CSRF_SECRET: productionSecret(),
        RATE_LIMIT_SECRET: productionSecret(),
        IDEMPOTENCY_SECRET: productionSecret(),
        MAIL_OUTBOX_KEY: productionSecret(),
        AUTH_SECRET_PROVENANCE: 'vault',
        AUTH_SECRET_PROVENANCE_REF: 'vault://secret/auth/cornerstone/v1',
      }),
    ).toMatchObject({ NODE_ENV: 'production' });
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

    expect(() =>
      validateDatabaseEnvironment({
        DATABASE_URL: requiredEnvironment.DATABASE_URL,
        DATABASE_MAINTENANCE_URL:
          'postgresql://maintenance:maintenance@localhost:5432/other',
      }),
    ).toThrow();
  });

  it('requires distinct production maintenance principals when configured', () => {
    expect(() =>
      validateDatabaseEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://runtime:runtime@db.example.com/cornerstone',
        DATABASE_MIGRATION_URL:
          'postgresql://migration:migration@db.example.com/cornerstone',
        DATABASE_MAINTENANCE_URL:
          'postgresql://runtime:other@db.example.com/cornerstone',
        DATABASE_SSL_MODE: 'verify-full',
      }),
    ).toThrow();
  });
});

function secret(label: string): string {
  return Buffer.from(`${label}-key-material-at-least-32-bytes`).toString(
    'base64url',
  );
}

function productionSecret(): string {
  return randomBytes(32).toString('base64url');
}

function exactSecret(label: string): string {
  return Buffer.from(label.padEnd(32, '-').slice(0, 32)).toString('base64url');
}
