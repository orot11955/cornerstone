#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultPolicyPath = path.resolve(
  scriptDirectory,
  '../release/auth-password-policy.json',
);
const policyPath =
  process.env.NODE_ENV === 'test' && process.env.PASSWORD_BENCHMARK_POLICY_PATH
    ? path.resolve(process.env.PASSWORD_BENCHMARK_POLICY_PATH)
    : defaultPolicyPath;

try {
  const policyText = await readFile(policyPath, 'utf8');
  const policy = validatePolicy(JSON.parse(policyText));
  const options = parseArguments(process.argv.slice(2), policy);
  const runtimeParameters = await loadRuntimePasswordParameters();
  assertRuntimePolicy(policy.parameters, runtimeParameters);
  const result = await benchmark(
    policy,
    policyText,
    options,
    runtimeParameters,
  );
  if (options.output) {
    await mkdir(path.dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await chmod(options.output, 0o600);
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${message(error)}\n`);
  process.exitCode = 1;
}

async function benchmark(policy, policyText, options, parameters) {
  const hashOptions = {
    type: argon2.argon2id,
    memoryCost: parameters.memoryCostKib,
    timeCost: parameters.timeCost,
    parallelism: parameters.parallelism,
    hashLength: parameters.hashLength,
  };
  const password = Buffer.from('cornerstone-password-benchmark-v1');
  for (let index = 0; index < options.warmup; index += 1) {
    const hash = await argon2.hash(password, hashOptions);
    if (!(await argon2.verify(hash, password)))
      throw new Error('Warmup verify failed');
  }

  const hashMs = [];
  const verifyMs = [];
  for (let index = 0; index < options.samples; index += 1) {
    const hashStarted = performance.now();
    const hash = await argon2.hash(password, hashOptions);
    hashMs.push(performance.now() - hashStarted);
    const verifyStarted = performance.now();
    if (!(await argon2.verify(hash, password)))
      throw new Error('Benchmark verify failed');
    verifyMs.push(performance.now() - verifyStarted);
    assertHashParameters(hash, parameters);
  }
  const latencyMs = {
    hash: percentiles(hashMs),
    verify: percentiles(verifyMs),
  };
  const production = options.mode === 'production';
  const passed =
    !production ||
    (latencyMs.hash.p95 <= policy.targets.hashP95Ms &&
      latencyMs.verify.p95 <= policy.targets.verifyP95Ms);
  return {
    schemaVersion: policy.schemaVersion,
    evidenceClass: production ? 'release' : 'non-production-test',
    policyDigest: createHash('sha256').update(policyText).digest('hex'),
    parameters,
    samples: { warmup: options.warmup, measured: options.samples },
    targets: policy.targets,
    percentile: policy.percentile,
    latencyMs,
    runtime: {
      node: process.version,
      platform: process.platform,
      os: `${os.type()} ${os.release()}`,
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cpuCount: os.cpus().length,
    },
    passed,
  };
}

async function loadRuntimePasswordParameters() {
  const resolverPath = path.resolve(
    scriptDirectory,
    '../dist/auth/password-runtime-policy.js',
  );
  let resolvePasswordRuntimeParameters;
  try {
    ({ resolvePasswordRuntimeParameters } = await import(resolverPath));
  } catch {
    throw new Error('Build the API before running the password benchmark');
  }
  try {
    return resolvePasswordRuntimeParameters(process.env);
  } catch {
    throw new Error('Invalid Argon2 runtime parameter');
  }
}

function assertRuntimePolicy(policy, runtime) {
  if (
    policy.memoryCostKib !== runtime.memoryCostKib ||
    policy.timeCost !== runtime.timeCost ||
    policy.parallelism !== runtime.parallelism ||
    policy.hashLength !== runtime.hashLength
  ) {
    throw new Error('Runtime password parameters drift from release policy');
  }
}

function parseArguments(arguments_, policy) {
  const values = {
    mode: 'production',
    warmup: policy.benchmark.defaultWarmup,
    samples: policy.benchmark.defaultSamples,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--mode') values.mode = arguments_[++index];
    else if (argument === '--warmup')
      values.warmup = integer(arguments_[++index], 'warmup');
    else if (argument === '--samples')
      values.samples = integer(arguments_[++index], 'samples');
    else if (argument === '--output')
      values.output = path.resolve(
        integerString(arguments_[++index], 'output'),
      );
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  if (!['production', 'fast'].includes(values.mode))
    throw new Error('mode must be production or fast');
  if (values.warmup < 0 || values.warmup > policy.benchmark.maximumWarmup)
    throw new Error('warmup is outside policy bounds');
  const minimumSamples =
    values.mode === 'production' ? policy.benchmark.minimumSamples : 1;
  if (
    values.samples < minimumSamples ||
    values.samples > policy.benchmark.maximumSamples
  )
    throw new Error('samples are outside policy bounds');
  return values;
}

function validatePolicy(policy) {
  if (policy?.schemaVersion !== 1 || policy.algorithm !== 'argon2id')
    throw new Error('Unsupported password benchmark policy');
  const { parameters, benchmark, targets, evidenceSchema, percentile } = policy;
  if (
    !parameters ||
    !Number.isSafeInteger(parameters.memoryCostKib) ||
    !Number.isSafeInteger(parameters.timeCost) ||
    !Number.isSafeInteger(parameters.parallelism) ||
    !Number.isSafeInteger(parameters.hashLength) ||
    parameters.memoryCostKib < 19_456 ||
    parameters.memoryCostKib > 262_144 ||
    parameters.timeCost < 2 ||
    parameters.timeCost > 5 ||
    parameters.parallelism < 1 ||
    parameters.parallelism > 4 ||
    parameters.hashLength < 16 ||
    parameters.hashLength > 64
  )
    throw new Error('Invalid password benchmark parameters');
  if (
    !benchmark ||
    !targets ||
    !evidenceSchema ||
    !percentile ||
    !Number.isSafeInteger(benchmark.minimumSamples) ||
    !Number.isSafeInteger(benchmark.defaultSamples) ||
    !Number.isSafeInteger(benchmark.defaultWarmup) ||
    !Number.isSafeInteger(benchmark.maximumSamples) ||
    !Number.isSafeInteger(benchmark.maximumWarmup) ||
    benchmark.minimumSamples < 1 ||
    benchmark.defaultSamples < benchmark.minimumSamples ||
    benchmark.defaultWarmup < 0 ||
    benchmark.maximumSamples < benchmark.defaultSamples ||
    benchmark.maximumWarmup < benchmark.defaultWarmup ||
    !Number.isFinite(targets.hashP95Ms) ||
    !Number.isFinite(targets.verifyP95Ms) ||
    targets.hashP95Ms <= 0 ||
    targets.verifyP95Ms <= 0 ||
    percentile.method !== 'nearest-rank' ||
    percentile.version !== 1 ||
    !Array.isArray(evidenceSchema.required) ||
    ![
      'schemaVersion',
      'evidenceClass',
      'policyDigest',
      'parameters',
      'samples',
      'targets',
      'percentile',
      'latencyMs',
      'runtime',
      'passed',
    ].every((field) => evidenceSchema.required.includes(field))
  )
    throw new Error('Invalid password benchmark policy');
  return policy;
}

function assertHashParameters(hash, parameters) {
  const match =
    /^\$argon2id\$v=19\$([mtp]=\d+,[mtp]=\d+,[mtp]=\d+)\$[^$]+\$([^$]+)$/.exec(
      hash,
    );
  if (!match) throw new Error('Argon2 output parameters drift from policy');
  const values = new Map(
    match[1].split(',').map((entry) => {
      const [name, value] = entry.split('=');
      return [name, Number(value)];
    }),
  );
  if (
    values.get('m') !== parameters.memoryCostKib ||
    values.get('t') !== parameters.timeCost ||
    values.get('p') !== parameters.parallelism ||
    Buffer.from(match[2], 'base64').length !== parameters.hashLength
  ) {
    throw new Error('Argon2 output parameters drift from policy');
  }
}

function percentiles(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50: round(sorted[Math.ceil(sorted.length * 0.5) - 1]),
    p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    max: round(sorted.at(-1)),
  };
}

function integer(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${name} must be an integer`);
  return parsed;
}

function integerString(value, name) {
  if (!value || value.startsWith('-')) throw new Error(`${name} is required`);
  return value;
}

function round(value) {
  return Number(value.toFixed(3));
}

function message(error) {
  return error instanceof Error ? error.message : 'Password benchmark failed';
}
