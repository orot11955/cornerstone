import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { stringify } from 'yaml'
import {
  bundledCapabilityCatalog,
  createProject,
  createProjectFromManifest,
  formatJsonDocument,
  getCapabilityApplicationOrder,
  mergeJsonContributions,
  parseCapabilityCatalog,
  planProject,
  projectLockSchema,
  canonicalTemplateMetadataSchema,
  resolveCapabilities,
  resolveManifest,
  validateCanonicalOwnership,
  verifyProject,
} from '../dist/index.js'

const digest = `sha256:${'a'.repeat(64)}`

function catalogWith(id, changes) {
  return bundledCapabilityCatalog.map((metadata) =>
    metadata.id === id ? { ...metadata, ...changes } : { ...metadata },
  )
}

function validV1Lock() {
  return {
    schemaVersion: 1,
    generatorVersion: '0.1.0',
    templateVersion: '0.1.0',
    userManifestDigest: digest,
    resolved: {
      schemaVersion: 1,
      name: 'sample-app',
      profile: 'minimal',
      capabilities: [],
      providers: {},
    },
    compatibility: { node: '>=22.20.0 <25', pnpm: '11.20.0' },
    fragments: [{ id: 'base', checksum: digest }],
    integrity: digest,
  }
}

function validV2Lock() {
  return {
    schemaVersion: 2,
    generatorVersion: '0.2.0',
    templateVersion: '0.2.0',
    userManifestDigest: digest,
    resolved: {
      schemaVersion: 1,
      name: 'sample-app',
      profile: 'minimal',
      capabilities: [],
      providers: {},
    },
    compatibility: {
      node: '>=22.20.0 <25',
      pnpm: '11.20.0',
      typescript: '5.9.3',
    },
    baselines: { manifest: 1, database: 'core-v1', openapi: 'v1' },
    fragments: [{ id: 'base', version: 1, checksum: digest }],
    composers: [{ id: 'package-json', version: 1, checksum: digest }],
    outputs: [{ path: 'src/index.ts', owner: 'base', checksum: digest, mode: 420 }],
    certification: { profile: 'minimal', matrix: 'node24-pnpm11', status: 'supported' },
    integrity: digest,
  }
}

test('resolves the minimal profile without optional capabilities', () => {
  assert.deepEqual(
    resolveManifest({ schemaVersion: 1, name: 'sample-app', profile: 'minimal' }).capabilities,
    [],
  )
})

test('resolves dependency closure lexically and exposes deterministic application order', () => {
  const capabilities = resolveCapabilities(['web', 'auth'])
  assert.deepEqual(capabilities, ['api', 'auth', 'database', 'ui', 'web'])
  assert.deepEqual(getCapabilityApplicationOrder(capabilities), [
    'api',
    'database',
    'auth',
    'ui',
    'web',
  ])
  assert.deepEqual(getCapabilityApplicationOrder([...capabilities].reverse()), [
    'api',
    'database',
    'auth',
    'ui',
    'web',
  ])
})

test('rejects invalid capability metadata and unsupported compositions', () => {
  assert.throws(
    () => parseCapabilityCatalog(catalogWith('ui', { dependencies: ['web'] })),
    /cycle/i,
  )
  assert.throws(
    () => parseCapabilityCatalog(catalogWith('api', { dependencies: ['api'] })),
    /self-dependency/i,
  )
  assert.throws(
    () => parseCapabilityCatalog(catalogWith('api', { unexpected: true })),
    /unrecognized key/i,
  )
  assert.throws(
    () =>
      resolveCapabilities(['web', 'api'], { catalog: catalogWith('ui', { conflicts: ['api'] }) }),
    /conflict/i,
  )
  assert.throws(() => resolveCapabilities(['api', 'api']), /duplicate/i)
  assert.throws(() => resolveCapabilities(['unknown']), /invalid option/i)
})

test('fails closed for experimental capabilities outside production profiles', () => {
  assert.throws(
    () =>
      resolveManifest({
        schemaVersion: 1,
        name: 'sample-app',
        profile: 'minimal',
        capabilities: ['observability'],
      }),
    /experimental/i,
  )

  const production = resolveManifest({
    schemaVersion: 1,
    name: 'sample-app',
    profile: 'production',
    providers: {
      hosting: 'acme',
      registry: 'acme',
      secretStore: 'acme',
      backup: 'acme',
      mail: 'acme',
    },
  })
  assert.equal(production.capabilities.includes('observability'), true)
})

test('parses legacy v1 and strict reader-first v2 project locks', () => {
  assert.equal(projectLockSchema.parse(validV1Lock()).schemaVersion, 1)
  assert.equal(projectLockSchema.parse(validV2Lock()).schemaVersion, 2)

  assert.throws(
    () => projectLockSchema.parse({ ...validV2Lock(), unknown: true }),
    /unrecognized key/i,
  )

  const incomplete = validV2Lock()
  delete incomplete.resolved.providers
  assert.throws(() => projectLockSchema.parse(incomplete))

  const traversal = validV2Lock()
  traversal.outputs[0].path = '../src/index.ts'
  assert.throws(() => projectLockSchema.parse(traversal), /normalized POSIX relative path/i)

  const duplicate = validV2Lock()
  duplicate.outputs.push({
    ...duplicate.outputs[0],
    path: 'SRC/index.ts',
    owner: 'package-json',
  })
  assert.throws(() => projectLockSchema.parse(duplicate), /duplicate output path/i)

  const nonNormalized = validV2Lock()
  nonNormalized.outputs[0].path = 'docs/cafe\u0301.md'
  assert.throws(() => projectLockSchema.parse(nonNormalized), /NFC normalization/i)

  const unicodeDuplicate = validV2Lock()
  unicodeDuplicate.outputs = [
    { ...unicodeDuplicate.outputs[0], path: 'docs/caf\u00e9.md' },
    { ...unicodeDuplicate.outputs[0], path: 'docs/cafe\u0301.md' },
  ]
  assert.throws(() => projectLockSchema.parse(unicodeDuplicate), /duplicate output path/i)

  const duplicateFragment = validV2Lock()
  duplicateFragment.fragments.push({ ...duplicateFragment.fragments[0] })
  assert.throws(() => projectLockSchema.parse(duplicateFragment), /duplicate fragment id/i)

  const duplicateComposer = validV2Lock()
  duplicateComposer.composers.push({ ...duplicateComposer.composers[0], version: 2 })
  assert.throws(() => projectLockSchema.parse(duplicateComposer), /duplicate composer id/i)

  const unknownOwner = validV2Lock()
  unknownOwner.outputs[0].owner = 'unknown-owner'
  assert.throws(() => projectLockSchema.parse(unknownOwner), /owner must reference/i)

  const mismatchedProfile = validV2Lock()
  mismatchedProfile.certification.profile = 'standard'
  assert.throws(
    () => projectLockSchema.parse(mismatchedProfile),
    /must match the resolved profile/i,
  )
})

test('resolves exported JSON schemas and preserves structural uniqueItems checks', async () => {
  const catalogSchemaPath = import.meta
    .resolve('create-cornerstone/schemas/capability-catalog.schema.json')
  const lockSchemaPath = import.meta.resolve('create-cornerstone/schemas/manifest.lock.schema.json')
  const catalogSchema = JSON.parse(await readFile(new URL(catalogSchemaPath), 'utf8'))
  const lockSchema = JSON.parse(await readFile(new URL(lockSchemaPath), 'utf8'))

  assert.equal(catalogSchema.items.properties.dependencies.uniqueItems, true)
  assert.equal(catalogSchema.items.properties.conflicts.uniqueItems, true)
  assert.equal(lockSchema.$defs.v2.properties.fragments.uniqueItems, true)
  assert.equal(lockSchema.$defs.v2.properties.composers.uniqueItems, true)
  assert.equal(lockSchema.$defs.v2.properties.outputs.uniqueItems, true)
})

test('parses v2 locks before generator-owned verification', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-v2-reader-test-'))
  await mkdir(join(fixture, '.cornerstone'))
  await writeFile(
    join(fixture, '.cornerstone', 'manifest.lock.json'),
    `${JSON.stringify(validV2Lock(), null, 2)}\n`,
  )

  await assert.rejects(verifyProject(fixture), /integrity mismatch/)

  const invalid = { ...validV2Lock(), unexpected: true }
  await writeFile(
    join(fixture, '.cornerstone', 'manifest.lock.json'),
    `${JSON.stringify(invalid, null, 2)}\n`,
  )
  await assert.rejects(verifyProject(fixture), /unrecognized key/i)
})

test('rejects unresolved production provider slots', () => {
  assert.throws(
    () =>
      resolveManifest({
        schemaVersion: 1,
        name: 'sample-app',
        profile: 'production',
      }),
    /require hosting/,
  )
})

test('creates the exact standard preview deterministically with real v2 ownership', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-create-test-'))
  const manifestPath = join(fixture, 'manifest.yml')
  const first = join(fixture, 'project-a')
  const second = join(fixture, 'project-b')
  await writeFile(
    manifestPath,
    stringify({ schemaVersion: 1, name: 'sample-app', profile: 'standard' }),
  )

  const firstLock = await createProject(first, manifestPath)
  const secondLock = await createProject(second, manifestPath)
  assert.equal(firstLock.schemaVersion, 2)
  assert.deepEqual(firstLock, secondLock)
  assert.deepEqual(
    firstLock.fragments.map(({ id }) => id),
    ['api', 'auth', 'base', 'database', 'ui', 'web'],
  )
  assert.equal(firstLock.certification.status, 'supported')
  assert.equal(firstLock.certification.matrix, 'standard-preview-node24-pg17')
  assert.equal(
    firstLock.fragments.every(({ checksum }) => checksum !== digest),
    true,
  )
  assert.equal(
    firstLock.composers.every(({ checksum }) => checksum !== digest),
    true,
  )
  assert.equal(
    firstLock.outputs.every(({ mode }) => Number.isInteger(mode)),
    true,
  )
  assert.equal(
    await readFile(join(first, 'NOTICE'), 'utf8').then((value) => value.length > 0),
    true,
  )
  await assert.rejects(stat(join(first, 'LICENSE')))
  assert.equal(
    firstLock.outputs.some(({ path }) => path === 'LICENSE'),
    false,
  )
  assert.equal(
    firstLock.fragments.some(({ id }) => id === 'privacy'),
    false,
  )
  assert.equal(
    firstLock.fragments.some(({ id }) => id === 'observability'),
    false,
  )
  assert.equal((await verifyProject(first)).integrity, firstLock.integrity)
  const generatedReadme = await readFile(join(first, 'README.md'), 'utf8')
  assert.match(generatedReadme, /local-development fixtures only/)
  assert.match(generatedReadme, /NODE_ENV=production/)
  assert.match(generatedReadme, /does not require user-owned fragment source/)
  assert.match(generatedReadme, /self-consistency digest/)

  const prettierCheck = spawnSync(
    'pnpm',
    [
      'exec',
      'prettier',
      '--check',
      join(first, '.cornerstone/manifest.lock.json'),
      join(first, 'pnpm-workspace.yaml'),
      join(first, 'test-scope.json'),
      join(first, 'turbo.json'),
    ],
    { cwd: new URL('../../..', import.meta.url), encoding: 'utf8' },
  )
  assert.equal(prettierCheck.status, 0, `${prettierCheck.stdout}${prettierCheck.stderr}`)

  const plan = planProject(
    resolveManifest({ schemaVersion: 1, name: 'sample-app', profile: 'standard' }),
  )
  assert.equal(plan.files.includes('apps/web/package.json'), true)
  assert.equal(plan.files.includes('apps/api/package.json'), true)
  assert.equal(plan.files.includes('infra/compose/compose.dev.yml'), true)
  assert.equal(plan.files.includes('NOTICE'), true)
  assert.equal(plan.files.includes('LICENSE'), false)
})

test('writes only a selected project LICENSE for standard', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-license-test-'))
  const lock = await createProjectFromManifest(join(fixture, 'project'), {
    schemaVersion: 1,
    name: 'licensed-app',
    profile: 'standard',
    license: 'MIT',
  })
  assert.equal(lock.schemaVersion, 2)
  assert.equal(lock.outputs.find(({ path }) => path === 'LICENSE')?.owner, 'license')
  assert.match(await readFile(join(fixture, 'project', 'LICENSE'), 'utf8'), /MIT License/)
})

test('fails structured composer conflicts and direct shared ownership before writing', () => {
  assert.deepEqual(
    mergeJsonContributions([
      { owner: 'base', value: { scripts: { test: 'node --test' } } },
      { owner: 'api', value: { scripts: { test: 'node --test', build: 'nest build' } } },
    ]),
    { scripts: { test: 'node --test', build: 'nest build' } },
  )
  assert.throws(
    () =>
      mergeJsonContributions([
        { owner: 'base', value: { scripts: { test: 'node --test' } } },
        { owner: 'api', value: { scripts: { test: 'jest' } } },
      ]),
    /composer conflict.*scripts\.test/i,
  )
  assert.throws(
    () =>
      validateCanonicalOwnership({ base: ['package.json'] }, [
        { id: 'root-package-json', output: 'package.json' },
      ]),
    /composer-owned path/i,
  )
  for (const value of [
    JSON.parse('{"nested":{"__proto__":{"polluted":true}}}'),
    { nested: { prototype: { polluted: true } } },
    { nested: { constructor: { polluted: true } } },
    { nested: { __proto__: { polluted: true } } },
  ]) {
    assert.throws(
      () => mergeJsonContributions([{ owner: 'malicious', value }]),
      /forbidden key|unsafe object prototype/i,
    )
  }
  assert.equal({}.polluted, undefined)
})

test('formats primitive JSON arrays at the configured 100-column boundary', () => {
  const withinWidth = formatJsonDocument({ values: ['x'.repeat(84)] })
  const overWidth = formatJsonDocument({ values: ['x'.repeat(85)] })

  assert.equal(withinWidth.split('\n')[1].length, 100)
  assert.match(withinWidth, /^\{\n  "values": \["x+"\]\n\}\n$/)
  assert.match(overWidth, /^\{\n  "values": \[\n    "x+"\n  \]\n\}\n$/)
})

test('rejects git pathspec magic in canonical source metadata', () => {
  const metadata = JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      templateVersion: '0.2.0',
      profiles: {
        standard: {
          capabilities: ['api', 'auth', 'database', 'ui', 'web'],
          certification: { matrix: 'standard-preview-node24-pg17', status: 'supported' },
        },
      },
      fragments: [
        { id: 'base', version: 1, mappings: [{ source: ':(glob)apps/**' }] },
        ...bundledCapabilityCatalog.map(({ id }) => ({ id, version: 1, mappings: [] })),
      ],
      composers: [],
    }),
  )
  assert.throws(() => canonicalTemplateMetadataSchema.parse(metadata), /pathspec magic/i)
})

test('standard verification rejects generator-owned content and mode drift', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-v2-drift-test-'))
  const target = join(fixture, 'project')
  await createProjectFromManifest(target, {
    schemaVersion: 1,
    name: 'sample-app',
    profile: 'standard',
  })
  const userOwnedSource = join(target, 'apps/web/src/app/page.tsx')
  await writeFile(
    userOwnedSource,
    `${await readFile(userOwnedSource, 'utf8')}\n// user-owned change\n`,
  )
  await verifyProject(target)
  await writeFile(join(target, 'package.json'), '{}\n')
  await assert.rejects(verifyProject(target), /output drift.*package\.json/i)

  const modeTarget = join(fixture, 'mode-project')
  await createProjectFromManifest(modeTarget, {
    schemaVersion: 1,
    name: 'mode-app',
    profile: 'standard',
  })
  await chmod(join(modeTarget, 'README.md'), 0o600)
  await assert.rejects(verifyProject(modeTarget), /mode drift.*README\.md/i)
})

test('production generation remains fail-closed after provider resolution', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-production-test-'))
  await assert.rejects(
    createProjectFromManifest(join(fixture, 'project'), {
      schemaVersion: 1,
      name: 'production-app',
      profile: 'production',
      providers: {
        hosting: 'acme',
        registry: 'acme',
        secretStore: 'acme',
        backup: 'acme',
        mail: 'acme',
      },
    }),
    /production and regulated remain uncertified/i,
  )
})

test('atomically promotes into an empty target and preserves a raced target', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-promotion-test-'))
  const emptyTarget = join(fixture, 'empty-target')
  await mkdir(emptyTarget)
  await createProjectFromManifest(emptyTarget, {
    schemaVersion: 1,
    name: 'empty-target',
    profile: 'standard',
  })
  assert.equal((await verifyProject(emptyTarget)).schemaVersion, 2)

  const racedTarget = join(fixture, 'raced-target')
  await mkdir(racedTarget)
  const creation = createProjectFromManifest(racedTarget, {
    schemaVersion: 1,
    name: 'raced-target',
    profile: 'standard',
  })
  const stagingPrefix = '.raced-target.cornerstone-staging-'
  let sawStaging = false
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await readdir(fixture)).some((entry) => entry.startsWith(stagingPrefix))) {
      sawStaging = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(sawStaging, true, 'generator staging directory was not observed')
  await writeFile(join(racedTarget, 'other-owner.txt'), 'preserve')
  await assert.rejects(creation, /ENOTEMPTY|directory not empty/i)
  assert.equal(await readFile(join(racedTarget, 'other-owner.txt'), 'utf8'), 'preserve')
  assert.deepEqual(await readdir(racedTarget), ['other-owner.txt'])
})

test('rejects oversized manifests and YAML aliases before resolution', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-input-limit-test-'))
  const oversized = join(fixture, 'oversized.yml')
  await writeFile(oversized, `schemaVersion: 1\nname: oversized\n# ${'x'.repeat(1024 * 1024)}\n`)
  await assert.rejects(
    createProject(join(fixture, 'oversized-project'), oversized),
    /1 MiB input limit/i,
  )

  const aliased = join(fixture, 'aliased.yml')
  await writeFile(
    aliased,
    'schemaVersion: 1\nname: aliased\nprofile: &profile minimal\nlicense: *profile\n',
  )
  await assert.rejects(createProject(join(fixture, 'aliased-project'), aliased), /alias/i)

  const target = join(fixture, 'lock-project')
  await createProjectFromManifest(target, {
    schemaVersion: 1,
    name: 'lock-project',
    profile: 'minimal',
  })
  await writeFile(
    join(target, '.cornerstone', 'manifest.lock.json'),
    `{"padding":"${'x'.repeat(1024 * 1024)}"}`,
  )
  await assert.rejects(verifyProject(target), /1 MiB input limit/i)
})

test('rejects secret-like unknown manifest keys', () => {
  assert.throws(() =>
    resolveManifest({
      schemaVersion: 1,
      name: 'sample-app',
      token: 'must-not-be-here',
    }),
  )
})

test('creates and verifies a deterministic secret-free project lock', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-create-test-'))
  const manifestPath = join(fixture, 'manifest.yml')
  const target = join(fixture, 'project')
  await writeFile(
    manifestPath,
    stringify({
      schemaVersion: 1,
      name: 'sample-app',
      profile: 'minimal',
      license: 'ISC',
    }),
  )

  const lock = await createProject(target, manifestPath)
  assert.equal((await verifyProject(target)).integrity, lock.integrity)
  assert.equal(lock.resolved.capabilities.length, 0)
  assert.equal(JSON.stringify(lock).includes('secret'), false)
  assert.equal(JSON.stringify(lock).includes('credential'), false)
})

test('rejects drift and leaves non-empty targets unchanged', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-create-test-'))
  const manifestPath = join(fixture, 'manifest.yml')
  const target = join(fixture, 'project')
  await writeFile(
    manifestPath,
    stringify({ schemaVersion: 1, name: 'sample-app', profile: 'minimal' }),
  )
  await mkdir(target)
  await writeFile(join(target, 'owned.txt'), 'preserve')

  await assert.rejects(createProject(target, manifestPath), /must be empty/)
  assert.deepEqual(await readdir(target), ['owned.txt'])

  const generated = join(fixture, 'generated')
  await createProject(generated, manifestPath)
  await writeFile(
    join(generated, 'cornerstone.config.yml'),
    stringify({ schemaVersion: 1, name: 'changed-app', profile: 'minimal' }),
  )
  await assert.rejects(verifyProject(generated), /digest/)
  assert.equal(await readFile(join(target, 'owned.txt'), 'utf8'), 'preserve')
})

test('rejects a manually edited lock manifest', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-create-test-'))
  const manifestPath = join(fixture, 'manifest.yml')
  const target = join(fixture, 'project')
  await writeFile(
    manifestPath,
    stringify({ schemaVersion: 1, name: 'sample-app', profile: 'minimal' }),
  )
  await createProject(target, manifestPath)
  const lockPath = join(target, '.cornerstone', 'manifest.lock.json')
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  lock.generatorVersion = '9.9.9'
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  await assert.rejects(verifyProject(target), /generatorVersion|0\.1\.0/)
})

test('rejects an unknown lock field before trusting its contents', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-create-test-'))
  const manifestPath = join(fixture, 'manifest.yml')
  const target = join(fixture, 'project')
  await writeFile(
    manifestPath,
    stringify({ schemaVersion: 1, name: 'sample-app', profile: 'minimal' }),
  )
  await createProject(target, manifestPath)
  const lockPath = join(target, '.cornerstone', 'manifest.lock.json')
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  lock.secret = 'unexpected'
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  await assert.rejects(verifyProject(target), /unrecognized key/i)
})

test('interactive and manifest create use the same resolved plan', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-create-test-'))
  const interactiveTarget = join(fixture, 'interactive-app')
  const result = spawnSync(process.execPath, ['dist/cli.js', 'create', interactiveTarget], {
    cwd: new URL('..', import.meta.url),
    input: '\n\nISC\n',
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)

  const manifestPath = join(fixture, 'manifest.yml')
  const manifestTarget = join(fixture, 'manifest-app')
  await writeFile(
    manifestPath,
    stringify({
      schemaVersion: 1,
      name: 'interactive-app',
      profile: 'minimal',
      license: 'ISC',
    }),
  )
  const manifestLock = await createProject(manifestTarget, manifestPath)
  const interactiveLock = await verifyProject(interactiveTarget)
  assert.equal(interactiveLock.userManifestDigest, manifestLock.userManifestDigest)
  assert.deepEqual(interactiveLock.resolved, manifestLock.resolved)
})
