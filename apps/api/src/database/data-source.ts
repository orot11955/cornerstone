import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { buildDatabaseOptions } from './database-options.js';

const environment = validateDatabaseEnvironment(process.env);

export const migrationDataSource = new DataSource(
  buildDatabaseOptions(environment, 'migration'),
);

export default migrationDataSource;
