import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { buildDatabaseOptions } from './database-options.js';

const runtimeUrl = 'postgresql://runtime:runtime@localhost:5432/cornerstone';
const migrationUrl =
  'postgresql://migrator:migrator@localhost:5432/cornerstone';
const maintenanceUrl =
  'postgresql://maintenance:maintenance@localhost:5432/cornerstone';

describe('buildDatabaseOptions', () => {
  const environment = validateDatabaseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: runtimeUrl,
    DATABASE_MIGRATION_URL: migrationUrl,
    DATABASE_MAINTENANCE_URL: maintenanceUrl,
  });

  it('selects the least-privilege connection for each purpose', () => {
    expect(buildDatabaseOptions(environment, 'runtime')).toMatchObject({
      url: runtimeUrl,
      synchronize: false,
      migrationsRun: false,
    });
    expect(buildDatabaseOptions(environment, 'migration')).toMatchObject({
      url: migrationUrl,
      synchronize: false,
      migrationsRun: false,
    });
    expect(buildDatabaseOptions(environment, 'maintenance')).toMatchObject({
      url: maintenanceUrl,
      synchronize: false,
      migrationsRun: false,
    });
  });

  it('resolves source and compiled globs without URL encoding', () => {
    const options = buildDatabaseOptions(environment, 'migration');

    expect(options.entities).toEqual([
      expect.stringContaining('*.entity.{js,ts}'),
    ]);
    expect(options.migrations).toEqual([
      expect.stringContaining('migrations/*-*.{js,ts}'),
    ]);
  });

  it('requires a separate migration URL in production', () => {
    const productionEnvironment = validateDatabaseEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://runtime:runtime@db.example.com/cornerstone',
      DATABASE_SSL_MODE: 'verify-full',
    });

    expect(() =>
      buildDatabaseOptions(productionEnvironment, 'migration'),
    ).toThrow('DATABASE_MIGRATION_URL is required');
    expect(() =>
      buildDatabaseOptions(productionEnvironment, 'maintenance'),
    ).toThrow('DATABASE_MAINTENANCE_URL is required');
  });
});
