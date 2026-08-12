process.env.NODE_ENV = 'test';
process.env.WEB_URL = 'http://localhost:3000';
process.env.DATABASE_URL =
  'postgresql://cornerstone_test_app:cornerstone-test-app@localhost:55432/cornerstone_test';
process.env.DATABASE_MIGRATION_URL =
  'postgresql://cornerstone_test_migrator:cornerstone-test-migrator@localhost:55432/cornerstone_test';
process.env.JWT_ACCESS_KID = 'test-access-v1';
process.env.JWT_ACCESS_KEY = Buffer.from(
  'cornerstone-test-access-key-v1-32-bytes',
).toString('base64url');
process.env.REFRESH_TOKEN_KEY_VERSION = 'test-refresh-v1';
process.env.REFRESH_TOKEN_PEPPER = Buffer.from(
  'cornerstone-test-refresh-key-v1-32-bytes',
).toString('base64url');
process.env.ACTION_TOKEN_KEY_VERSION = 'test-action-v1';
process.env.ACTION_TOKEN_PEPPER = Buffer.from(
  'cornerstone-test-action-key-v1-32-bytes',
).toString('base64url');
process.env.CSRF_KEY_VERSION = 'test-csrf-v1';
process.env.CSRF_SECRET = Buffer.from(
  'cornerstone-test-csrf-key-v1-32-bytes',
).toString('base64url');
process.env.RATE_LIMIT_SECRET = Buffer.from(
  'cornerstone-test-rate-key-v1-32-bytes',
).toString('base64url');
process.env.MAIL_OUTBOX_KEY_VERSION = 'test-mail-v1';
process.env.MAIL_OUTBOX_KEY = Buffer.from(
  'cornerstone-test-mail-key-v1-32b',
).toString('base64url');
process.env.AUTH_SECRET_PROVENANCE = 'local';
