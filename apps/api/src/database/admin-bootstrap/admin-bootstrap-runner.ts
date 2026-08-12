import { DataSource } from 'typeorm';
import { ZodError } from 'zod';
import { buildAdminBootstrapDatabaseOptions } from './admin-bootstrap-database-options.js';
import { validateAdminBootstrapEnvironment } from './admin-bootstrap-environment.js';
import {
  AdminBootstrapError,
  bootstrapInitialAdmin,
} from './admin-bootstrap.service.js';
import {
  AdminBootstrapInputError,
  readAdminBootstrapPassword,
} from './admin-bootstrap-password-input.js';

const EXIT_USAGE = 2;
const EXIT_REJECTED = 3;
const EXIT_FAILURE = 4;

async function run(): Promise<void> {
  if (process.argv.length !== 2) throw new UsageError();
  const environment = validateAdminBootstrapEnvironment(process.env);
  const email = environment.ADMIN_BOOTSTRAP_EMAIL;
  const password = await readAdminBootstrapPassword(environment);
  try {
    const source = new DataSource(
      buildAdminBootstrapDatabaseOptions(environment),
    );
    try {
      await source.initialize();
      const result = await bootstrapInitialAdmin(source, {
        email,
        password,
        requestId: environment.ADMIN_BOOTSTRAP_REQUEST_ID,
        argon2: {
          memoryCostKib: environment.ARGON2_MEMORY_KIB,
          timeCost: environment.ARGON2_TIME_COST,
          parallelism: environment.ARGON2_PARALLELISM,
        },
      });
      process.stdout.write(
        `Admin bootstrap succeeded: userId=${result.userId} auditId=${result.auditId}\n`,
      );
    } finally {
      if (source.isInitialized) await source.destroy();
    }
  } finally {
    password.fill(0);
  }
}

class UsageError extends Error {}

void run().catch((error: unknown) => {
  const code =
    error instanceof UsageError ||
    error instanceof AdminBootstrapInputError ||
    error instanceof ZodError
      ? EXIT_USAGE
      : error instanceof AdminBootstrapError && error.code === 'ADMIN_EXISTS'
        ? EXIT_REJECTED
        : EXIT_FAILURE;
  const message =
    code === EXIT_USAGE
      ? 'Admin bootstrap rejected: invalid secure input configuration'
      : code === EXIT_REJECTED
        ? 'Admin bootstrap rejected: an active administrator already exists'
        : 'Admin bootstrap failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
});
