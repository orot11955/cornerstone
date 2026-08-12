import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { standardPolicy, validateStandardInventory } from './standard-candidate-policy.mjs'

const root = resolve(import.meta.dirname, '..')
const mode = process.argv.includes('--standard-candidate') ? 'standard-candidate' : 'minimal'
const artifacts = join(root, '.artifacts', 'generator', mode)
const fixturePrefix = `cornerstone-generator-${mode}-`
const fixture = mkdtempSync(join(tmpdir(), fixturePrefix))
const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
let workspaceStore

function run(command, args, cwd = root, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, CI: '1', ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0 && !options.allowFailure) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status ?? 1}`)
  }
  return result
}

try {
  workspaceStore = runStorePath()
  rmSync(artifacts, { recursive: true, force: true })
  mkdirSync(artifacts, { recursive: true })

  run(executable, ['--filter', 'create-cornerstone', 'build'])
  if (mode === 'standard-candidate') {
    run(executable, ['--filter', 'create-cornerstone', 'test:unit'])
    run('node', ['scripts/standard-candidate-policy.mjs', '--self-test'])
  }
  const packedResult = run(executable, [
    '--dir',
    'packages/create-cornerstone',
    'pack',
    '--pack-destination',
    artifacts,
    '--json',
  ])
  const packed = JSON.parse(packedResult.stdout)
  const filename = packed.filename ?? packed[0]?.filename
  if (!filename) throw new Error('create-cornerstone pack did not return a filename')
  const tarball = resolve('packages/create-cornerstone', filename)
  const tarEntries = run('tar', ['-tf', tarball]).stdout.split(/\r?\n/)
  for (const required of [
    'package/dist/update.js',
    'package/dist/templates/canonical/standard.json',
    'package/dist/templates/canonical/fragments/base/scripts/check-package-licenses.mjs',
  ]) {
    if (!tarEntries.includes(required)) throw new Error(`Generator tarball is missing ${required}`)
  }

  writeFileSync(
    join(fixture, 'package.json'),
    `${JSON.stringify(
      {
        name: 'cornerstone-generator-consumer',
        private: true,
        packageManager: 'pnpm@11.20.0',
        dependencies: { 'create-cornerstone': `file:${tarball}` },
      },
      null,
      2,
    )}\n`,
  )
  installWrapperConsumer(fixture)

  if (mode === 'minimal') verifyMinimal()
  else verifyStandardCandidate()
} finally {
  cleanupTemporaryDirectory(fixture, fixturePrefix)
}

function verifyMinimal() {
  writeManifest('minimal', 'ISC')
  for (const target of ['project-a', 'project-b']) {
    createAndVerify(target)
    installGeneratedProject(join(fixture, target))
    for (const script of ['typecheck', 'build', 'test'])
      run(executable, [script], join(fixture, target))
  }
  const firstDigest = digestDirectory(join(fixture, 'project-a'))
  const secondDigest = digestDirectory(join(fixture, 'project-b'))
  if (firstDigest !== secondDigest)
    throw new Error('Generated minimal projects are not byte-stable')
  const generatedFiles = listFiles(join(fixture, 'project-a'))
  if (generatedFiles.some((file) => /(auth|database|observability|privacy)/i.test(file))) {
    throw new Error('Minimal profile contains an unselected capability')
  }
  writeReport('generator-consumer-report.json', {
    schemaVersion: 2,
    gate: 'minimal-consumer',
    profile: 'minimal',
    byteStableDigest: firstDigest,
    checks: ['frozen-install', 'typecheck', 'build', 'test'],
    status: 'passed',
  })
  console.log('Generator consumer verification: OK (minimal profile)')
}

function verifyStandardCandidate() {
  writeManifest('standard', 'UNLICENSED')
  for (const target of ['standard-a', 'standard-b']) createAndVerify(target)
  const first = join(fixture, 'standard-a')
  const second = join(fixture, 'standard-b')
  const firstDigest = digestDirectory(first)
  const secondDigest = digestDirectory(second)
  if (firstDigest !== secondDigest)
    throw new Error('Generated Standard projects are not byte-stable')
  const policy = validateStandardPolicy(first, false)
  run(executable, ['exec', 'create-cornerstone', 'plan', 'standard-a', '--dry-run'], fixture)
  run(executable, ['exec', 'create-cornerstone', 'update', 'standard-a'], fixture)
  run(executable, ['exec', 'create-cornerstone', 'verify', 'standard-a'], fixture)
  if (digestDirectory(first) !== firstDigest) {
    throw new Error('Current Standard lifecycle update was not a byte-stable no-op')
  }

  writeManifest('standard', 'ISC')
  createAndVerify('standard-license')
  validateStandardPolicy(join(fixture, 'standard-license'), true)

  installGeneratedProject(first)
  const qualityScripts = [
    'format:check',
    'build',
    'lint',
    'typecheck',
    'test:unit',
    'test:component',
    'package:check',
    'package:verify',
    'license:check',
  ]
  for (const script of qualityScripts) run(executable, [script], first)

  writeReport('standard-candidate-report.json', {
    schemaVersion: 1,
    gate: 'standard-candidate',
    certificationStatus: 'supported',
    certificationPromotionRequires: ['UIF', 'M6', 'M8 Standard Core browser E2E'],
    profile: 'standard',
    platform: { os: process.platform, pathSeparator: sep, canonicalFileNames: 'posix-relative' },
    lineEndings: { composerOwned: 'LF', status: 'passed' },
    byteStableDigest: firstDigest,
    tarball: { canonicalSnapshot: true, updateRuntime: true, licenseChecker: true },
    qualityScripts,
    unitEvidence: {
      command: 'pnpm --filter create-cornerstone test:unit',
      includes: [
        'update predecessor plan/update/verify/idempotency/rollback',
        'oversized input and YAML alias rejection',
        'path traversal, symlink and update journal rejection',
        'structured composer prototype-pollution rejection',
      ],
      status: 'passed',
    },
    lifecycleEvidence: {
      commands: [
        'create-cornerstone plan standard-a --dry-run',
        'create-cornerstone update standard-a',
        'create-cornerstone verify standard-a',
      ],
      currentUpdate: 'no-op',
      byteStable: true,
      status: 'passed',
    },
    residuePolicy: policy,
    databaseCandidate: 'separate-ubuntu-only-job',
    status: 'passed',
  })
  console.log(
    'Generator Standard candidate verification: OK (quality/reproducibility; not certified)',
  )
}

function createAndVerify(target) {
  run(
    executable,
    ['exec', 'create-cornerstone', 'create', target, '--manifest', 'cornerstone.config.yml'],
    fixture,
  )
  run(executable, ['exec', 'create-cornerstone', 'verify', target], fixture)
}

function writeManifest(profile, license) {
  writeFileSync(
    join(fixture, 'cornerstone.config.yml'),
    `schemaVersion: 1\nname: generated-app\nprofile: ${profile}\nlicense: ${license}\n`,
  )
}

function installWrapperConsumer(directory) {
  install(directory, ['--ignore-workspace'])
}

function installGeneratedProject(directory) {
  install(directory, ['--frozen-lockfile'])
}

function install(directory, installOptions) {
  const base = ['install', '--store-dir', workspaceStore, ...installOptions]
  const offline = run(executable, [...base, '--offline'], directory, { allowFailure: true })
  if (offline.status === 0) return
  if (process.env.CORNERSTONE_OFFLINE_ONLY === '1') {
    process.stderr.write(offline.stdout)
    process.stderr.write(offline.stderr)
    throw new Error('Offline install failed while CORNERSTONE_OFFLINE_ONLY=1')
  }
  run(executable, base, directory)
}

function runStorePath() {
  const result = spawnSync(executable, ['store', 'path'], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Unable to resolve the workspace pnpm store path')
  return result.stdout.trim()
}

function validateStandardPolicy(directory, licenseSelected) {
  const files = listFiles(directory)
  const lock = JSON.parse(readFileSync(join(directory, '.cornerstone/manifest.lock.json'), 'utf8'))
  if (lock.certification.status !== 'supported')
    throw new Error('Standard candidate became certified')
  if (!existsSync(join(directory, 'NOTICE'))) throw new Error('Standard NOTICE is missing')
  if (existsSync(join(directory, 'LICENSE')) !== licenseSelected) {
    throw new Error('Standard LICENSE selection policy failed')
  }
  const policy = {
    allowedCapabilities: standardPolicy.allowedCapabilities,
    exactFragments: standardPolicy.exactFragments,
    exactWorkspaces: standardPolicy.exactWorkspaces,
    unselectedCapabilities: Object.keys(standardPolicy.unselectedCapabilities),
    providers: {},
    allowedEnvironmentFiles: ['apps/api/.env.example', 'apps/web/.env.example'],
    forbiddenPathPatterns: [
      '(^|/)node_modules(/|$)',
      '(^|/)\\.next(/|$)',
      '(^|/)packages/create-cornerstone(/|$)',
      '(^|/)privacy(/|$)',
      '(^|/)\\.env(?!\\.example$)',
      '\\.(pem|key|p12|pfx)$',
    ],
  }
  if (JSON.stringify(lock.resolved.providers) !== '{}') throw new Error('Provider residue in lock')
  const violations = policy.forbiddenPathPatterns.flatMap((source) => {
    const pattern = new RegExp(source, 'i')
    return files.filter((file) => pattern.test(file)).map((file) => ({ pattern: source, file }))
  })
  const fragmentIds = lock.fragments.map(({ id }) => id).sort()
  if (JSON.stringify(fragmentIds) !== JSON.stringify(policy.exactFragments)) {
    violations.push({ pattern: 'exact-fragment-set', file: fragmentIds.join(',') })
  }
  for (const output of lock.outputs) {
    const bytes = readFileSync(join(directory, output.path))
    if (bytes.includes(Buffer.from('\r\n'))) {
      violations.push({ pattern: 'composer-output-crlf', file: output.path })
    }
  }
  const workspaceManifests = files
    .filter((file) => /^(apps|packages)\/[^/]+\/package\.json$/.test(file))
    .map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')))
  const workspaceNames = workspaceManifests.map(({ name }) => name).sort()
  if (JSON.stringify(workspaceNames) !== JSON.stringify([...policy.exactWorkspaces].sort())) {
    violations.push({ pattern: 'exact-workspace-set', file: workspaceNames.join(',') })
  }
  const dependencies = workspaceManifests.flatMap((manifest) =>
    Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    }).map((name) => ({ owner: manifest.name, name })),
  )
  const environmentFiles = files.filter((file) => /(^|\/)\.env(?:\.|$)/.test(file))
  if (JSON.stringify(environmentFiles) !== JSON.stringify(policy.allowedEnvironmentFiles)) {
    violations.push({ pattern: 'environment-file-set', file: environmentFiles.join(',') })
  }
  const apiEnvironmentKeys = parseEnvironmentKeys(join(directory, 'apps/api/.env.example'))
  const webEnvironmentKeys = parseEnvironmentKeys(join(directory, 'apps/web/.env.example'))
  for (const key of ['OTEL_EXPORTER_OTLP_ENDPOINT', 'SENTRY_DSN', 'PRODUCTION_DATABASE_URL']) {
    if (apiEnvironmentKeys.includes(key) || webEnvironmentKeys.includes(key)) {
      violations.push({ pattern: 'forbidden-environment-key', file: key })
    }
  }
  for (const required of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'DATABASE_MAINTENANCE_URL']) {
    if (!apiEnvironmentKeys.includes(required)) {
      violations.push({ pattern: 'required-api-environment-key', file: required })
    }
  }
  for (const required of ['SITE_URL', 'APP_LOCALE']) {
    if (!webEnvironmentKeys.includes(required)) {
      violations.push({ pattern: 'required-web-environment-key', file: required })
    }
  }
  const compose = readFileSync(join(directory, 'infra/compose/compose.test.yml'), 'utf8')
  if (!/^\s{2}postgres:\s*$/m.test(compose) || /^\s{2}(?!postgres:)[\w-]+:\s*$/m.test(compose)) {
    violations.push({ pattern: 'compose-service-set', file: 'infra/compose/compose.test.yml' })
  }
  const ci = readFileSync(join(directory, '.github/workflows/ci.yml'), 'utf8')
  if (/generator:verify|standard-candidate|create-cornerstone/i.test(ci)) {
    violations.push({ pattern: 'unsupported-generated-ci-job', file: '.github/workflows/ci.yml' })
  }
  if (!files.includes('docs/adr/0017-release-gates.md')) {
    violations.push({
      pattern: 'required-release-gate-doc',
      file: 'docs/adr/0017-release-gates.md',
    })
  }
  const inventoryViolations = validateStandardInventory({
    capabilities: lock.resolved.capabilities,
    fragmentIds,
    workspaceNames,
    files,
    dependencies,
    environmentKeys: {
      'apps/api/.env.example': apiEnvironmentKeys,
      'apps/web/.env.example': webEnvironmentKeys,
    },
    composeServices: parseComposeServices(compose),
    ci,
    documents: files
      .filter((file) => file.startsWith('docs/') && /\.(?:md|txt)$/i.test(file))
      .map((file) => ({ path: file, content: readFileSync(join(directory, file), 'utf8') })),
  })
  violations.push(
    ...inventoryViolations.map((violation) => ({
      pattern: 'capability-residue',
      file: JSON.stringify(violation),
    })),
  )
  if (violations.length > 0)
    throw new Error(`Standard residue policy failed: ${JSON.stringify(violations)}`)
  return { ...policy, violations }
}

function parseComposeServices(source) {
  const services = []
  let insideServices = false
  for (const line of source.split(/\r?\n/)) {
    if (/^services:\s*$/.test(line)) {
      insideServices = true
      continue
    }
    if (insideServices && /^\S/.test(line)) break
    const match = insideServices ? /^  ([A-Za-z0-9_-]+):\s*$/.exec(line) : undefined
    if (match) services.push(match[1])
  }
  return services.sort()
}

function parseEnvironmentKeys(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')))
    .sort()
}

function digestDirectory(directory) {
  const hash = createHash('sha256')
  for (const name of listFiles(directory))
    hash.update(`${name}\0`).update(readFileSync(join(directory, name)))
  return `sha256:${hash.digest('hex')}`
}

function listFiles(directory) {
  const output = []
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (['node_modules', 'dist', '.next', '.turbo', '.artifacts'].includes(entry.name)) continue
      const path = join(current, entry.name)
      const name = relative(directory, path).split(sep).join('/')
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) output.push(name)
      else throw new Error(`Generated project contains unsupported entry: ${name}`)
    }
  }
  visit(directory)
  return output.sort()
}

function writeReport(filename, value) {
  writeFileSync(join(artifacts, filename), `${JSON.stringify(value, null, 2)}\n`)
}

function cleanupTemporaryDirectory(directory, expectedPrefix) {
  const metadata = lstatSync(directory)
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('Refusing to clean an unsafe generator fixture')
  const canonicalDirectory = realpathSync(directory)
  const canonicalTemporaryRoot = realpathSync(tmpdir())
  if (
    realpathSync(dirname(directory)) !== canonicalTemporaryRoot ||
    dirname(canonicalDirectory) !== canonicalTemporaryRoot ||
    !basename(canonicalDirectory).startsWith(expectedPrefix)
  ) {
    throw new Error('Refusing to clean a generator fixture outside the exact temporary prefix')
  }
  rmSync(canonicalDirectory, { recursive: true })
}
