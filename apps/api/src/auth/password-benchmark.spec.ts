import { execFile } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateEnvironment } from '../config/env.schema.js';

const execFileAsync = promisify(execFile);
const script = new URL('../../scripts/password-benchmark.mjs', import.meta.url);
const policy = new URL(
  '../../release/auth-password-policy.json',
  import.meta.url,
);

beforeAll(async () => {
  await execFileAsync('pnpm', ['build'], {
    cwd: path.resolve(path.dirname(script.pathname), '..'),
  });
});

describe('password benchmark release harness', () => {
  it('defines the production Argon2id policy and machine-readable evidence schema', async () => {
    const parsed: unknown = JSON.parse(await readFile(policy, 'utf8'));
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) return;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.productionClass).toBe('minimum-supported-production');
    expect(parsed.algorithm).toBe('argon2id');
    expect(parsed.parameters).toEqual({
      memoryCostKib: 65_536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
    });
    expect(isRecord(parsed.benchmark)).toBe(true);
    expect(isRecord(parsed.targets)).toBe(true);
    expect(isRecord(parsed.evidenceSchema)).toBe(true);
    if (!isRecord(parsed.evidenceSchema)) return;
    expect(parsed.evidenceSchema.required).toEqual(
      expect.arrayContaining([
        'policyDigest',
        'latencyMs',
        'targets',
        'percentile',
        'passed',
      ]),
    );
  });

  it('matches the application production Argon2 environment defaults', async () => {
    const parsed: unknown = JSON.parse(await readFile(policy, 'utf8'));
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed) || !isRecord(parsed.parameters)) return;
    const environment = validateEnvironment(defaultEnvironment());
    expect(parsed.parameters).toEqual({
      memoryCostKib: environment.ARGON2_MEMORY_KIB,
      timeCost: environment.ARGON2_TIME_COST,
      parallelism: environment.ARGON2_PARALLELISM,
      hashLength: 32,
    });
  });

  it('emits non-production fast evidence without password or hash material', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [script.pathname, '--mode', 'fast', '--warmup', '0', '--samples', '1'],
      { env: benchmarkEnvironment(), maxBuffer: 16_384 },
    );
    expect(stderr).toBe('');
    const evidence: unknown = JSON.parse(stdout);
    expect(isRecord(evidence)).toBe(true);
    if (!isRecord(evidence)) return;
    expect(evidence.evidenceClass).toBe('non-production-test');
    expect(evidence.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.samples).toEqual({ warmup: 0, measured: 1 });
    expectLatency(evidence.latencyMs);
    expect(isRecord(evidence.runtime)).toBe(true);
    if (!isRecord(evidence.runtime)) return;
    expect(typeof evidence.runtime.node).toBe('string');
    expect(typeof evidence.runtime.cpu).toBe('string');
    expect(evidence.passed).toBe(true);
    expect(stdout).not.toContain('cornerstone-password-benchmark-v1');
    expect(stdout).not.toContain('$argon2');
  });

  it('fails closed for unbounded production sampling', async () => {
    try {
      await execFileAsync(
        process.execPath,
        [script.pathname, '--samples', '1'],
        { env: benchmarkEnvironment() },
      );
      throw new Error('Expected benchmark argument rejection');
    } catch (error) {
      expect(isRecord(error)).toBe(true);
      if (!isRecord(error)) return;
      expect(error.code).toBe(1);
      expect(error.stderr).toContain('samples are outside policy bounds');
    }
  });

  it('rejects malformed policy fixtures and hardens existing evidence output permissions', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'password-benchmark-'),
    );
    const malformedPolicy = path.join(directory, 'malformed-policy.json');
    const evidence = path.join(directory, 'evidence.json');
    try {
      const malformed: unknown = JSON.parse(await readFile(policy, 'utf8'));
      expect(isRecord(malformed)).toBe(true);
      if (!isRecord(malformed) || !isRecord(malformed.targets)) return;
      malformed.targets.hashP95Ms = 0;
      await writeFile(malformedPolicy, JSON.stringify(malformed));
      await expectBenchmarkFailure(
        ['--mode', 'fast', '--samples', '1'],
        { NODE_ENV: 'test', PASSWORD_BENCHMARK_POLICY_PATH: malformedPolicy },
        'Invalid password benchmark policy',
      );

      await writeFile(evidence, 'old evidence');
      await chmod(evidence, 0o644);
      await execFileAsync(
        process.execPath,
        [
          script.pathname,
          '--mode',
          'fast',
          '--warmup',
          '0',
          '--samples',
          '1',
          '--output',
          evidence,
        ],
        { env: benchmarkEnvironment(), maxBuffer: 16_384 },
      );
      expect((await stat(evidence)).mode & 0o777).toBe(0o600);
      expect(isRecord(JSON.parse(await readFile(evidence, 'utf8')))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function expectLatency(value: unknown): void {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) return;
  for (const operation of ['hash', 'verify']) {
    expect(isRecord(value[operation])).toBe(true);
    if (!isRecord(value[operation])) continue;
    for (const percentile of ['p50', 'p95', 'max']) {
      expect(typeof value[operation][percentile]).toBe('number');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultEnvironment(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    WEB_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://runtime:runtime@localhost/cornerstone',
    DATABASE_MIGRATION_URL:
      'postgresql://migration:migration@localhost/cornerstone',
    DATABASE_MAINTENANCE_URL:
      'postgresql://maintenance:maintenance@localhost/cornerstone',
    JWT_ACCESS_KID: 'access-v1',
    JWT_ACCESS_KEY: encodedSecret(1),
    REFRESH_TOKEN_KEY_VERSION: 'refresh-v1',
    REFRESH_TOKEN_PEPPER: encodedSecret(2),
    ACTION_TOKEN_KEY_VERSION: 'action-v1',
    ACTION_TOKEN_PEPPER: encodedSecret(3),
    CSRF_KEY_VERSION: 'csrf-v1',
    CSRF_SECRET: encodedSecret(4),
    RATE_LIMIT_SECRET: encodedSecret(5),
    IDEMPOTENCY_SECRET: encodedSecret(6),
    MAIL_OUTBOX_KEY_VERSION: 'mail-v1',
    MAIL_OUTBOX_KEY: encodedSecret(7),
    AUTH_SECRET_PROVENANCE: 'local',
  };
}

function encodedSecret(value: number): string {
  return Buffer.alloc(32, value).toString('base64url');
}

function benchmarkEnvironment(
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return { ...process.env, ...defaultEnvironment(), ...extra };
}

async function expectBenchmarkFailure(
  arguments_: string[],
  environment: Record<string, string>,
  expectedMessage: string,
): Promise<void> {
  try {
    await execFileAsync(process.execPath, [script.pathname, ...arguments_], {
      env: benchmarkEnvironment(environment),
    });
    throw new Error('Expected benchmark failure');
  } catch (error) {
    expect(isRecord(error)).toBe(true);
    if (!isRecord(error)) return;
    expect(error.code).toBe(1);
    expect(error.stderr).toContain(expectedMessage);
  }
}
