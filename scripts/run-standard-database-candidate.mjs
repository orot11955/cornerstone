import { createHash, randomBytes } from 'node:crypto'
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const artifacts = join(root, '.artifacts', 'generator', 'standard-candidate')
const fixturePrefix = 'cornerstone-standard-database-candidate-'
const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const store = command(['store', 'path'], root, { capture: true }).trim()
const composeEnvironment = {
  COMPOSE_PROJECT_NAME: `cornerstone-standard-candidate-${randomBytes(8).toString('hex')}`,
}
const databaseUrls = {
  DATABASE_URL:
    'postgresql://cornerstone_test_app:cornerstone-test-app@localhost:55432/cornerstone_test',
  DATABASE_MIGRATION_URL:
    'postgresql://cornerstone_test_migrator:cornerstone-test-migrator@localhost:55432/cornerstone_test',
  DATABASE_MAINTENANCE_URL:
    'postgresql://cornerstone_test_maintenance:cornerstone-test-maintenance@localhost:55432/cornerstone_test',
}
const databaseEnvironment = validateDatabaseEnvironment({
  NODE_ENV: 'test',
  ...databaseUrls,
})
const bootstrapDatabaseEnvironment = validateDatabaseEnvironment(
  {
    ...databaseEnvironment,
    DATABASE_ADMIN_BOOTSTRAP_URL:
      'postgresql://cornerstone_test_admin_bootstrap:cornerstone-test-admin-bootstrap@localhost:55432/cornerstone_test',
  },
  { adminBootstrap: true },
)
const fixture = mkdtempSync(join(tmpdir(), fixturePrefix))
const commands = []
let generated
let cleanup = 'not-started'

try {
  command(['--filter', 'create-cornerstone', 'build'])
  const packed = JSON.parse(
    command(
      ['--dir', 'packages/create-cornerstone', 'pack', '--pack-destination', fixture, '--json'],
      root,
      { capture: true },
    ),
  )
  const tarball = resolve('packages/create-cornerstone', packed.filename ?? packed[0]?.filename)
  writeFileSync(
    join(fixture, 'package.json'),
    `${JSON.stringify(
      {
        name: 'standard-database-candidate-consumer',
        private: true,
        packageManager: 'pnpm@11.20.0',
        dependencies: { 'create-cornerstone': `file:${tarball}` },
      },
      null,
      2,
    )}\n`,
  )
  installWrapperConsumer(fixture)
  writeFileSync(
    join(fixture, 'cornerstone.config.yml'),
    'schemaVersion: 1\nname: standard-db-candidate\nprofile: standard\nlicense: UNLICENSED\n',
  )
  command(
    ['exec', 'create-cornerstone', 'create', 'project', '--manifest', 'cornerstone.config.yml'],
    fixture,
  )
  generated = join(fixture, 'project')
  command(['exec', 'create-cornerstone', 'verify', 'project'], fixture)
  installGeneratedProject(generated)

  cleanup = 'required'
  runGenerated(['db:test:down'], { allowFailure: true, quiet: true })
  runGenerated(['db:test:up'])
  runGenerated(['migration:check'])
  runGenerated(['migration:run'], { database: true })
  runGenerated(['migration:revert'], { database: true })
  runGenerated(['migration:run'], { database: true })
  runGenerated(['seed'], { database: true })
  runGenerated(['seed'], { database: true })
  runGenerated(['exec', 'node', 'scripts/test-scope.mjs', 'test:integration', '--run'], {
    bootstrap: true,
  })
  runGenerated(['exec', 'node', 'scripts/test-scope.mjs', 'test:e2e', '--run'], {
    database: true,
  })
  runGenerated(['database:backup:verify'])
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Standard database candidate failed')
  process.exitCode = 1
} finally {
  try {
    if (cleanup === 'required' && generated) {
      cleanup = runGenerated(['db:test:down'], { allowFailure: true }) === 0 ? 'passed' : 'failed'
      if (cleanup === 'failed') process.exitCode = 1
    }
    if (generated) writeReport()
  } finally {
    cleanupTemporaryDirectory(fixture, fixturePrefix)
  }
}

function runGenerated(args, options = {}) {
  const status = command(args, generated, {
    allowFailure: options.allowFailure,
    quiet: options.quiet,
    env: {
      ...composeEnvironment,
      ...(options.bootstrap
        ? bootstrapDatabaseEnvironment
        : options.database
          ? databaseEnvironment
          : { NODE_ENV: 'test' }),
    },
    returnStatus: true,
  })
  if (!options.allowFailure) commands.push(`pnpm ${args.join(' ')}`)
  return status
}

function command(args, cwd = root, options = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    env: { ...process.env, ...options.env },
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : options.quiet ? 'ignore' : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    if (options.capture) {
      process.stderr.write(result.stdout)
      process.stderr.write(result.stderr)
    }
    throw new Error(`pnpm ${args.join(' ')} failed with ${result.status ?? 1}`)
  }
  if (options.capture) return result.stdout
  return options.returnStatus ? (result.status ?? 1) : undefined
}

function installWrapperConsumer(directory) {
  install(directory, ['--ignore-workspace'])
}

function installGeneratedProject(directory) {
  install(directory, ['--frozen-lockfile'])
}

function install(directory, installOptions) {
  const args = ['install', '--store-dir', store, ...installOptions]
  const offline = command([...args, '--offline'], directory, {
    allowFailure: true,
    returnStatus: true,
  })
  if (offline !== 0) command(args, directory)
}

function validateDatabaseEnvironment(values, options = {}) {
  if (values.NODE_ENV !== 'test')
    throw new Error('Standard database candidate requires NODE_ENV=test')
  const expected = {
    NODE_ENV: 'test',
    ...databaseUrls,
    ...(options.adminBootstrap
      ? {
          DATABASE_ADMIN_BOOTSTRAP_URL:
            'postgresql://cornerstone_test_admin_bootstrap:cornerstone-test-admin-bootstrap@localhost:55432/cornerstone_test',
        }
      : {}),
  }
  if (
    Object.keys(values).sort().join('\n') !== Object.keys(expected).sort().join('\n') ||
    Object.entries(expected).some(([name, value]) => values[name] !== value)
  ) {
    throw new Error('Standard database candidate environment differs from the exact test allowlist')
  }
  for (const [name, value] of Object.entries(expected)) {
    if (name === 'NODE_ENV') continue
    const url = new URL(value)
    if (
      url.hostname !== 'localhost' ||
      url.port !== '55432' ||
      url.pathname !== '/cornerstone_test' ||
      /prod(uction)?/i.test(url.pathname)
    ) {
      throw new Error(`${name} is outside the isolated Standard test database allowlist`)
    }
  }
  return values
}

function writeReport() {
  const lockBytes = readFileSync(join(generated, '.cornerstone/manifest.lock.json'))
  const lock = JSON.parse(lockBytes.toString('utf8'))
  mkdirSync(artifacts, { recursive: true })
  writeFileSync(
    join(artifacts, 'standard-database-candidate-report.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        gate: 'standard-database-candidate',
        certificationStatus: lock.certification.status,
        generated: {
          profile: lock.resolved.profile,
          templateVersion: lock.templateVersion,
          lockDigest: `sha256:${createHash('sha256').update(lockBytes).digest('hex')}`,
        },
        databaseBoundary: {
          nodeEnvironment: 'test',
          host: 'localhost',
          port: 55432,
          database: 'cornerstone_test',
          productionDatabaseAllowed: false,
          credentialsRecorded: false,
          isolatedComposeProject: true,
        },
        commands,
        cleanup,
        status: process.exitCode ? 'failed' : 'passed',
      },
      null,
      2,
    )}\n`,
  )
}

function cleanupTemporaryDirectory(directory, expectedPrefix) {
  const metadata = lstatSync(directory)
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('Refusing to clean an unsafe database candidate fixture')
  const canonicalDirectory = realpathSync(directory)
  const canonicalTemporaryRoot = realpathSync(tmpdir())
  if (
    realpathSync(dirname(directory)) !== canonicalTemporaryRoot ||
    dirname(canonicalDirectory) !== canonicalTemporaryRoot ||
    !basename(canonicalDirectory).startsWith(expectedPrefix)
  ) {
    throw new Error('Refusing to clean a database candidate fixture outside its temporary prefix')
  }
  rmSync(canonicalDirectory, { recursive: true })
}
