import { mkdtemp, chmod, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { validateAdminBootstrapEnvironment } from './admin-bootstrap-environment.js';
import {
  AdminBootstrapInputError,
  validatePasswordBuffer,
  readAdminBootstrapPassword,
} from './admin-bootstrap-password-input.js';
import {
  AdminBootstrapError,
  assertNormalizedBootstrapEmail,
  bootstrapInitialAdmin,
} from './admin-bootstrap.service.js';

const environment = {
  DATABASE_ADMIN_BOOTSTRAP_URL:
    'postgresql://bootstrap:bootstrap@localhost:5432/cornerstone',
  ADMIN_BOOTSTRAP_EMAIL: 'admin@example.test',
  ADMIN_BOOTSTRAP_REQUEST_ID: 'test-bootstrap',
};

describe('admin bootstrap input boundary', () => {
  it('accepts the minimal dedicated environment without application secrets', () => {
    expect(validateAdminBootstrapEnvironment(environment)).toMatchObject({
      NODE_ENV: 'development',
      ADMIN_BOOTSTRAP_EMAIL: 'admin@example.test',
    });
  });

  it('requires production TLS and a password file', () => {
    expect(() =>
      validateAdminBootstrapEnvironment({
        ...environment,
        NODE_ENV: 'production',
      }),
    ).toThrow();
    expect(() =>
      validateAdminBootstrapEnvironment({
        ...environment,
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'verify-full',
      }),
    ).toThrow();
    expect(
      validateAdminBootstrapEnvironment({
        ...environment,
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'verify-full',
        ADMIN_BOOTSTRAP_PASSWORD_FILE: '/run/secrets/admin-password',
        ADMIN_BOOTSTRAP_REQUEST_ID: 'approved-change-1234',
      }),
    ).toMatchObject({ NODE_ENV: 'production' });
  });

  it('rejects URL option overrides and invalid correlation IDs', () => {
    expect(() =>
      validateAdminBootstrapEnvironment({
        ...environment,
        DATABASE_ADMIN_BOOTSTRAP_URL: `${environment.DATABASE_ADMIN_BOOTSTRAP_URL}?sslmode=disable`,
      }),
    ).toThrow();
    expect(() =>
      validateAdminBootstrapEnvironment({
        ...environment,
        ADMIN_BOOTSTRAP_REQUEST_ID: 'contains whitespace',
      }),
    ).toThrow();
  });

  it('rejects non-normalized bootstrap email', () => {
    expect(() => assertNormalizedBootstrapEmail('Admin@Example.test')).toThrow(
      AdminBootstrapError,
    );
  });

  it('zeroizes the password when validation fails before hashing', async () => {
    const password = Buffer.from('short');
    await expect(
      bootstrapInitialAdmin({} as never, {
        email: environment.ADMIN_BOOTSTRAP_EMAIL,
        password,
        requestId: environment.ADMIN_BOOTSTRAP_REQUEST_ID,
        argon2: { memoryCostKib: 19_456, timeCost: 2, parallelism: 1 },
      }),
    ).rejects.toBeInstanceOf(AdminBootstrapError);
    expect(password.every((byte) => byte === 0)).toBe(true);
  });

  it('rejects newline, NUL, invalid UTF-8 and oversize passwords while zeroizing buffers', async () => {
    for (const value of [
      Buffer.from('has\nnewline'),
      Buffer.from('has\0nul'),
      Buffer.from([0xc3, 0x28]),
    ]) {
      expect(() => validatePasswordBuffer(value)).toThrow(
        AdminBootstrapInputError,
      );
      expect(value.every((byte) => byte === 0)).toBe(true);
    }
    await expect(
      readAdminBootstrapPassword(
        validateAdminBootstrapEnvironment(environment),
        Readable.from([Buffer.alloc(1025, 1)]),
      ),
    ).rejects.toBeInstanceOf(AdminBootstrapInputError);
  });

  it('rejects unsafe file permissions and production symlinks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cornerstone-bootstrap-'));
    const passwordFile = join(directory, 'password');
    const link = join(directory, 'link');
    try {
      await writeFile(passwordFile, 'bootstrap-password-123', { mode: 0o600 });
      await chmod(passwordFile, 0o644);
      await expect(
        readAdminBootstrapPassword(
          validateAdminBootstrapEnvironment({
            ...environment,
            ADMIN_BOOTSTRAP_PASSWORD_FILE: passwordFile,
          }),
        ),
      ).rejects.toBeInstanceOf(AdminBootstrapInputError);
      await chmod(passwordFile, 0o600);
      await symlink(passwordFile, link);
      await expect(
        readAdminBootstrapPassword(
          validateAdminBootstrapEnvironment({
            ...environment,
            NODE_ENV: 'production',
            DATABASE_SSL_MODE: 'verify-full',
            ADMIN_BOOTSTRAP_PASSWORD_FILE: link,
            ADMIN_BOOTSTRAP_REQUEST_ID: 'approved-change-1234',
          }),
        ),
      ).rejects.toBeInstanceOf(AdminBootstrapInputError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
