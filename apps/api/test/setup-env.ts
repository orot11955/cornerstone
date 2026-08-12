process.env.NODE_ENV = 'test';
process.env.WEB_URL = 'http://localhost:3000';
process.env.DATABASE_URL =
  'postgresql://cornerstone_test_app:cornerstone-test-app@localhost:55432/cornerstone_test';
process.env.DATABASE_MIGRATION_URL =
  'postgresql://cornerstone_test_migrator:cornerstone-test-migrator@localhost:55432/cornerstone_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret'.padEnd(32, 'a');
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret'.padEnd(32, 'b');
