import assert from 'node:assert/strict'
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { stringify } from 'yaml'
import {
  bundledCapabilityCatalog,
  canonicalScaffoldId,
  computeScaffoldsDigest,
  generateScaffold,
  isGeneratorControlPath,
  portableScaffoldPathsConflict,
  createProject,
  createProjectFromManifest,
  adoptStandardV3,
  formatJsonDocument,
  getCapabilityApplicationOrder,
  mergeJsonContributions,
  parseCapabilityCatalog,
  planProject,
  planScaffoldGeneration,
  readManifest,
  planStandardV3Adoption,
  planProjectUpdate,
  projectLockSchema,
  projectLockV3Schema,
  canonicalTemplateMetadataSchema,
  resolveCapabilities,
  resolveManifest,
  validateCanonicalOwnership,
  validateScaffoldRegistry,
  verifyProject,
  updateProject,
} from '../dist/index.js'
import {
  applyGeneratorMutation,
  injectUpdateFailureForTest,
  isTrustedUpdateParentPolicy,
  parseMutationJournalV2,
  planGeneratorMutation,
  setUpdateHookForTest,
} from '../dist/update-internal.js'
import {
  buildPredecessorLock,
  predecessorLockBytes,
  parsePredecessorSnapshot,
  readPredecessorAdoptionSource,
  resolvePredecessor,
} from '../dist/composition/predecessor.js'
import { createHash } from 'node:crypto'

const digest = `sha256:${'a'.repeat(64)}`

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    )
  }
  return value
}

function checksum(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

async function makePredecessorStandard(target, name = 'update-app', version = '0.2.0') {
  const userManifest = {
    schemaVersion: 1,
    name,
    profile: 'standard',
  }
  await createProjectFromManifest(target, userManifest)
  const persistedManifest = await readManifest(join(target, 'cornerstone.config.yml'))
  const manifest = resolveManifest(persistedManifest)
  const predecessor = await resolvePredecessor(version, manifest)
  for (const [path, content] of predecessor.contents) {
    await writeFile(join(target, path), content, { mode: 0o644 })
    await chmod(join(target, path), 0o644)
  }
  for (const source of predecessor.snapshot.adoptionSources) {
    await writeFile(
      join(target, source.path),
      await readPredecessorAdoptionSource(version, source.path),
      { mode: source.mode },
    )
    await chmod(join(target, source.path), source.mode)
  }
  const lock = buildPredecessorLock(predecessor, persistedManifest, manifest)
  await writeFile(join(target, '.cornerstone/manifest.lock.json'), predecessorLockBytes(lock))
  return lock
}

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

function validV3Lock() {
  const lock = {
    ...structuredClone(validV2Lock()),
    schemaVersion: 3,
    scaffolds: [
      {
        id: 'api:users',
        kind: 'api',
        version: 1,
        name: 'users',
        optionsDigest: digest,
        paths: ['apps/api/src/users/users.controller.ts'],
      },
      {
        id: 'package:@sample/audit',
        kind: 'package',
        version: 1,
        name: '@sample/audit',
        optionsDigest: digest,
        paths: ['packages/audit/package.json', 'packages/audit/src/index.ts'],
      },
    ],
    scaffoldsDigest: '',
  }
  lock.scaffoldsDigest = computeScaffoldsDigest(lock.scaffolds)
  return lock
}

async function makeMutationFixture() {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-mutation-v2-test-'))
  const target = join(fixture, 'project')
  await mkdir(join(target, '.cornerstone'), { recursive: true })
  await mkdir(join(target, 'shared'))
  const beforeLock = Buffer.from('{"version":1}\n')
  const afterLock = Buffer.from('{"version":2}\n')
  const beforeShared = Buffer.from('before\n')
  const afterShared = Buffer.from('after\n')
  await writeFile(join(target, '.cornerstone/manifest.lock.json'), beforeLock, { mode: 0o644 })
  await writeFile(join(target, 'shared/config.json'), beforeShared, { mode: 0o644 })
  const request = {
    operationKind: 'generate',
    lockPath: '.cornerstone/manifest.lock.json',
    createdDirectories: ['packages', 'packages/example', 'packages/example/src'],
    entries: [
      {
        action: 'add',
        path: 'packages/example/src/index.ts',
        content: Buffer.from('export const generated = true\n'),
        mode: 0o644,
      },
      {
        action: 'modify',
        path: 'shared/config.json',
        content: afterShared,
        mode: 0o644,
        beforeChecksum: checksum(beforeShared),
        beforeMode: 0o644,
      },
      {
        action: 'modify',
        path: '.cornerstone/manifest.lock.json',
        content: afterLock,
        mode: 0o644,
        beforeChecksum: checksum(beforeLock),
        beforeMode: 0o644,
      },
    ],
  }
  return { target, request, beforeLock, afterLock, beforeShared, afterShared }
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

test('parses strict reader-first v3 scaffold registries', () => {
  const lock = validV3Lock()
  assert.equal(projectLockSchema.parse(lock).schemaVersion, 3)
  assert.equal(projectLockV3Schema.parse(lock).scaffolds.length, 2)
  assert.equal(canonicalScaffoldId('feature', 'billing'), 'feature:billing')
  assert.deepEqual(validateScaffoldRegistry(lock.scaffolds), lock.scaffolds)
  assert.throws(
    () => validateScaffoldRegistry(lock.scaffolds, ['PACKAGES/AUDIT/PACKAGE.JSON']),
    /conflicts with an existing lock output/i,
  )
  assert.equal(isGeneratorControlPath('.CORNERSTONE/update.journal.json'), true)
  assert.equal(isGeneratorControlPath('apps/api/src/index.ts'), false)
  assert.equal(portableScaffoldPathsConflict('src/index.ts', 'SRC/INDEX.TS/generated.ts'), true)
  assert.equal(portableScaffoldPathsConflict('src/index.ts', 'src/index.tsx'), false)
  const legacyOddName = {
    id: 'feature:billing-',
    kind: 'feature',
    version: 1,
    name: 'billing-',
    optionsDigest: digest,
    paths: ['apps/api/src/legacy-feature.ts'],
  }
  assert.deepEqual(validateScaffoldRegistry([legacyOddName]), [legacyOddName])
  assert.throws(
    () => validateScaffoldRegistry(lock.scaffolds, ['packages/audit']),
    /existing lock output/i,
  )

  const migration = {
    id: 'migration:CreateAuditLog',
    kind: 'migration',
    version: 1,
    name: 'CreateAuditLog',
    optionsDigest: digest,
    paths: ['apps/api/src/database/migrations/CreateAuditLog.ts'],
  }
  assert.deepEqual(validateScaffoldRegistry([migration]), [migration])
  assert.throws(
    () =>
      validateScaffoldRegistry([
        { ...migration, id: 'migration:create-audit-log', name: 'create-audit-log' },
      ]),
    /Invalid migration scaffold name/i,
  )
  for (const kind of ['api', 'feature']) {
    assert.throws(
      () =>
        validateScaffoldRegistry([
          { id: `${kind}:a`, kind, version: 1, name: 'a', optionsDigest: digest, paths: ['a.ts'] },
        ]),
      new RegExp(`Invalid ${kind} scaffold name`, 'i'),
    )
  }

  const wrongId = validV3Lock()
  wrongId.scaffolds[0].id = 'api:accounts'
  wrongId.scaffoldsDigest = computeScaffoldsDigest(wrongId.scaffolds)
  assert.throws(() => projectLockSchema.parse(wrongId), /canonical kind:name relationship/i)

  const unsortedRegistry = validV3Lock()
  unsortedRegistry.scaffolds.reverse()
  unsortedRegistry.scaffoldsDigest = computeScaffoldsDigest(unsortedRegistry.scaffolds)
  assert.throws(() => projectLockSchema.parse(unsortedRegistry), /sorted by id/i)

  const unsortedPaths = validV3Lock()
  unsortedPaths.scaffolds[1].paths.reverse()
  unsortedPaths.scaffoldsDigest = computeScaffoldsDigest(unsortedPaths.scaffolds)
  assert.throws(() => projectLockSchema.parse(unsortedPaths), /paths must be sorted/i)

  const emptyPaths = validV3Lock()
  emptyPaths.scaffolds[0].paths = []
  emptyPaths.scaffoldsDigest = computeScaffoldsDigest(emptyPaths.scaffolds)
  assert.throws(() => projectLockSchema.parse(emptyPaths), /too small|at least one/i)

  const traversal = validV3Lock()
  traversal.scaffolds[0].paths = ['../secrets.txt']
  traversal.scaffoldsDigest = computeScaffoldsDigest(traversal.scaffolds)
  assert.throws(() => projectLockSchema.parse(traversal), /normalized POSIX relative path/i)

  const nonNfc = validV3Lock()
  nonNfc.scaffolds[0].paths = ['docs/cafe\u0301.md']
  nonNfc.scaffoldsDigest = computeScaffoldsDigest(nonNfc.scaffolds)
  assert.throws(() => projectLockSchema.parse(nonNfc), /NFC normalization/i)

  for (const reserved of ['CON', 'aux.txt', 'path/LPT1.md', 'path/trailing.']) {
    const reservedPath = validV3Lock()
    reservedPath.scaffolds[0].paths = [reserved]
    reservedPath.scaffoldsDigest = computeScaffoldsDigest(reservedPath.scaffolds)
    assert.throws(() => projectLockSchema.parse(reservedPath), /Windows-reserved/i)
  }

  for (const reservedName of ['con', 'aux']) {
    const reserved = validV3Lock()
    reserved.scaffolds[0].name = reservedName
    reserved.scaffolds[0].id = `api:${reservedName}`
    reserved.scaffoldsDigest = computeScaffoldsDigest(reserved.scaffolds)
    assert.throws(() => projectLockSchema.parse(reserved), /Windows-reserved name/i)
  }

  const reservedPackageName = validV3Lock()
  reservedPackageName.scaffolds[1].name = '@sample/com1'
  reservedPackageName.scaffolds[1].id = 'package:@sample/com1'
  reservedPackageName.scaffoldsDigest = computeScaffoldsDigest(reservedPackageName.scaffolds)
  assert.throws(() => projectLockSchema.parse(reservedPackageName), /Windows-reserved name/i)

  const trailingPackageName = validV3Lock()
  trailingPackageName.scaffolds[1].name = '@sample/audit.'
  trailingPackageName.scaffolds[1].id = 'package:@sample/audit.'
  trailingPackageName.scaffoldsDigest = computeScaffoldsDigest(trailingPackageName.scaffolds)
  assert.throws(() => projectLockSchema.parse(trailingPackageName), /trailing dot\/space/i)

  const globalCollision = validV3Lock()
  globalCollision.scaffolds[1].paths = ['APPS/API/SRC/USERS/USERS.CONTROLLER.TS']
  globalCollision.scaffoldsDigest = computeScaffoldsDigest(globalCollision.scaffolds)
  assert.throws(() => projectLockSchema.parse(globalCollision), /globally unique/i)

  const scaffoldAncestorCollision = validV3Lock()
  scaffoldAncestorCollision.scaffolds[0].paths = [
    'apps/api/src/users',
    'apps/api/src/users/generated.ts',
  ]
  scaffoldAncestorCollision.scaffoldsDigest = computeScaffoldsDigest(
    scaffoldAncestorCollision.scaffolds,
  )
  assert.throws(
    () => projectLockSchema.parse(scaffoldAncestorCollision),
    /ancestor\/descendant conflicts/i,
  )

  const fragmentOutputCollision = validV3Lock()
  fragmentOutputCollision.scaffolds[0].paths = ['SRC/INDEX.TS']
  fragmentOutputCollision.scaffoldsDigest = computeScaffoldsDigest(
    fragmentOutputCollision.scaffolds,
  )
  assert.throws(() => projectLockSchema.parse(fragmentOutputCollision), /existing lock output/i)

  const outputDescendantCollision = validV3Lock()
  outputDescendantCollision.scaffolds[0].paths = ['src/index.ts/generated.ts']
  outputDescendantCollision.scaffoldsDigest = computeScaffoldsDigest(
    outputDescendantCollision.scaffolds,
  )
  assert.throws(() => projectLockSchema.parse(outputDescendantCollision), /existing lock output/i)

  const outputAncestorCollision = validV3Lock()
  outputAncestorCollision.outputs[0].path = 'packages/audit/package.json/generated.json'
  outputAncestorCollision.scaffoldsDigest = computeScaffoldsDigest(
    outputAncestorCollision.scaffolds,
  )
  assert.throws(() => projectLockSchema.parse(outputAncestorCollision), /existing lock output/i)

  for (const reservedControlPath of [
    '.cornerstone/manifest.lock.json',
    '.CORNERSTONE/update-backup-id/README.md',
    '.cornerstone/scaffolds/registry.json',
    'cornerstone.config.yml',
    'CORNERSTONE.CONFIG.YML/nested',
  ]) {
    const controlCollision = validV3Lock()
    controlCollision.scaffolds[0].paths = [reservedControlPath]
    controlCollision.scaffoldsDigest = computeScaffoldsDigest(controlCollision.scaffolds)
    assert.throws(() => projectLockSchema.parse(controlCollision), /generator control namespace/i)
  }

  const badDigest = validV3Lock()
  badDigest.scaffoldsDigest = digest
  assert.throws(() => projectLockSchema.parse(badDigest), /registry digest mismatch/i)

  assert.throws(
    () => projectLockSchema.parse({ ...validV3Lock(), unexpected: true }),
    /unrecognized key/i,
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
  assert.equal(lockSchema.$defs.v3.properties.scaffolds.uniqueItems, true)
  assert.equal(lockSchema.$defs.scaffoldPaths.minItems, 1)
  assert.equal(lockSchema.$defs.scaffoldPaths.uniqueItems, true)
  assert.equal(lockSchema.$defs.scaffold.oneOf.length, 5)
  assert.equal(lockSchema.$defs.scaffold.oneOf[0].allOf.length, 3)
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

test('reads v3 locks and rejects non-canonical generator state', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-v3-reader-test-'))
  await mkdir(join(fixture, '.cornerstone'))
  await writeFile(
    join(fixture, 'cornerstone.config.yml'),
    'schemaVersion: 1\nname: sample-app\nprofile: minimal\n',
  )
  const lock = validV3Lock()
  lock.userManifestDigest = checksum(
    JSON.stringify(
      stable({
        schemaVersion: 1,
        name: 'sample-app',
        profile: 'minimal',
        capabilities: [],
        providers: {},
      }),
    ),
  )
  const { integrity: _integrity, ...unsigned } = lock
  lock.integrity = checksum(JSON.stringify(stable(unsigned)))
  await writeFile(
    join(fixture, '.cornerstone', 'manifest.lock.json'),
    `${JSON.stringify(lock, null, 2)}\n`,
  )
  await assert.rejects(verifyProject(fixture), /fragment checksum mismatch/i)
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
  assert.equal(firstLock.schemaVersion, 3)
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
  const generatedPackage = JSON.parse(await readFile(join(first, 'package.json'), 'utf8'))
  const generatedTurbo = JSON.parse(await readFile(join(first, 'turbo.json'), 'utf8'))
  assert.deepEqual(generatedTurbo.tasks.lint.dependsOn, ['^build', '^lint'])
  assert.equal(generatedPackage.scripts['api:build'], 'turbo run build --filter=api')
  for (const script of [
    'migration:show',
    'migration:run',
    'migration:revert',
    'database:verify',
    'retention:cleanup',
    'openapi:generate',
    'openapi:check',
    'seed',
    'admin:bootstrap',
  ]) {
    assert.match(generatedPackage.scripts[script], /^pnpm api:build && /)
  }
  assert.equal(
    generatedPackage.scripts['package:check'],
    'node scripts/validate-package-boundaries.mjs',
  )
  assert.equal(
    generatedPackage.scripts['package:verify'],
    'node scripts/verify-package-consumer.mjs',
  )
  assert.equal(generatedPackage.scripts['license:check'], 'node scripts/check-package-licenses.mjs')
  assert.equal(generatedPackage.scripts['generator:portability:compare'], undefined)
  const generatedCi = await readFile(join(first, '.github/workflows/ci.yml'), 'utf8')
  assert.doesNotMatch(generatedCi, /generator-portability(?:-compare)?/)
  for (const script of [
    'check-package-licenses.mjs',
    'validate-package-boundaries.mjs',
    'verify-package-consumer.mjs',
  ]) {
    assert.equal((await stat(join(first, 'scripts', script))).isFile(), true)
  }

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

test('composes exact Nest modules and adopts an exact Standard v2 project to v3 lock ownership', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-v3-adoption-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target, 'adoption-app', '0.2.1')
  const lockPath = join(target, '.cornerstone/manifest.lock.json')
  await verifyProject(target)

  const before = await readFile(lockPath)
  const userSource = join(target, 'apps/web/src/app/page.tsx')
  await writeFile(
    userSource,
    `${await readFile(userSource, 'utf8')}\n// preserved adoption source\n`,
  )
  const plan = await planStandardV3Adoption(target)
  assert.equal(plan.changes.at(-1).path, '.cornerstone/manifest.lock.json')
  assert.equal(
    plan.changes.some(({ path }) => path === 'apps/api/src/app.module.ts'),
    true,
  )
  assert.equal(
    plan.changes.some(({ path }) => path === 'apps/api/src/contracts/api-contract.module.ts'),
    true,
  )
  assert.deepEqual(await readFile(lockPath), before)
  assert.deepEqual((await adoptStandardV3(target, { dryRun: true })).changes, plan.changes)
  const adopted = await adoptStandardV3(target)
  assert.deepEqual(adopted.changes, plan.changes)
  assert.equal((await verifyProject(target)).schemaVersion, 3)
  assert.match(await readFile(userSource, 'utf8'), /preserved adoption source/)
})

test('rejects modified Nest predecessor and allows user-owned scaffold content drift in v3 verify', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-v3-scaffold-test-'))
  const target = join(fixture, 'project')
  const lock = await createProjectFromManifest(target, {
    schemaVersion: 1,
    name: 'scaffold-app',
    profile: 'standard',
  })
  const scaffoldPath = 'apps/api/src/user-feature.ts'
  await writeFile(join(target, scaffoldPath), 'export const userFeature = 1\n')
  lock.scaffolds = [
    {
      id: 'feature:user-feature',
      kind: 'feature',
      version: 1,
      name: 'user-feature',
      optionsDigest: digest,
      paths: [scaffoldPath],
    },
  ]
  lock.scaffoldsDigest = computeScaffoldsDigest(lock.scaffolds)
  const { integrity: _integrity, ...unsigned } = lock
  lock.integrity = checksum(JSON.stringify(stable(unsigned)))
  await writeFile(join(target, '.cornerstone/manifest.lock.json'), formatJsonDocument(lock))
  await writeFile(join(target, scaffoldPath), 'export const userFeature = 2\n')
  await verifyProject(target)
  await rm(join(target, scaffoldPath))
  await assert.rejects(verifyProject(target), /scaffold registry path.*regular file/i)
  await writeFile(join(target, scaffoldPath), 'export const userFeature = 3\n')

  await writeFile(join(target, 'apps/api/src/app.module.ts'), 'user edit\n')
  await assert.rejects(verifyProject(target), /generator-owned output drift.*app\.module\.ts/i)
})

test('rejects a modified exact v2 Nest predecessor before adoption writes', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-v3-modified-predecessor-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target, 'modified-predecessor-app', '0.2.1')
  await writeFile(join(target, 'apps/api/src/app.module.ts'), 'modified predecessor\n')
  await assert.rejects(
    planStandardV3Adoption(target),
    /generator-owned output drift|manual migration/i,
  )
})

test('rejects chmod drift in an exact v2 predecessor before v3 adoption', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-v3-mode-predecessor-test-'))
  const target = join(fixture, 'project')
  const lockPath = join(target, '.cornerstone/manifest.lock.json')
  await makePredecessorStandard(target, 'mode-predecessor-app', '0.2.1')
  const predecessorBytes = await readFile(lockPath, 'utf8')
  await chmod(join(target, 'README.md'), 0o600)

  await assert.rejects(planStandardV3Adoption(target), /manual migration required/i)
  assert.equal((await stat(join(target, 'README.md'))).mode & 0o777, 0o600)
  assert.equal(await readFile(lockPath, 'utf8'), predecessorBytes)
})

test('writes only a selected project LICENSE for standard', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-license-test-'))
  const lock = await createProjectFromManifest(join(fixture, 'project'), {
    schemaVersion: 1,
    name: 'licensed-app',
    profile: 'standard',
    license: 'MIT',
  })
  assert.equal(lock.schemaVersion, 3)
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

test('verifies immutable Standard v2 snapshots and rejects predecessor mode drift', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-legacy-snapshot-test-'))
  const target = join(fixture, 'project')
  const lock = await makePredecessorStandard(target, 'legacy-app', '0.2.1')
  assert.equal((await verifyProject(target)).integrity, lock.integrity)
  await chmod(join(target, 'README.md'), 0o600)
  await assert.rejects(verifyProject(target), /generator-owned output drift.*README\.md/i)
})

test('rejects malformed immutable predecessor adoption source contracts', () => {
  const base = {
    schemaVersion: 1,
    templateVersion: '0.2.1',
    fixtureName: 'snapshot-app',
    fragments: [{ id: 'base', version: 1, checksum: digest }],
    composers: [{ id: 'owner', version: 1, checksum: digest }],
    outputs: [{ path: 'package.json', owner: 'owner', checksum: digest, mode: 0o644 }],
    adoptionSources: [{ path: 'apps/api/src/app.module.ts', checksum: digest, mode: 0o644 }],
  }
  assert.throws(
    () =>
      parsePredecessorSnapshot({
        ...base,
        adoptionSources: [
          ...base.adoptionSources,
          { path: 'apps/api/src/app.module.ts', checksum: digest, mode: 0o644 },
        ],
      }),
    /adoptionSources must be sorted and unique/i,
  )
  assert.throws(
    () =>
      parsePredecessorSnapshot({
        ...base,
        adoptionSources: [{ path: 'package.json', checksum: digest, mode: 0o644 }],
      }),
    /adoption source overlaps output/i,
  )
})

test('chains the immutable Standard 0.2.0 update and 0.2.1 v3 adoption', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-predecessor-chain-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target, 'chain-app', '0.2.0')
  assert.equal((await verifyProject(target)).templateVersion, '0.2.0')
  await updateProject(target)
  assert.equal((await verifyProject(target)).templateVersion, '0.2.1')
  const adoptionPlan = await planStandardV3Adoption(target)
  assert.equal(adoptionPlan.changes.at(-1).path, '.cornerstone/manifest.lock.json')
  await adoptStandardV3(target)
  const adopted = await verifyProject(target)
  assert.equal(adopted.schemaVersion, 3)
  assert.equal(adopted.templateVersion, '0.3.0')
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
  assert.equal((await verifyProject(emptyTarget)).schemaVersion, 3)

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

test('plans and applies the deterministic Standard 0.2.0 to 0.2.1 update', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-test-'))
  const target = join(fixture, 'project')
  const oldLock = await makePredecessorStandard(target)
  const oldLockBytes = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  const userSource = join(target, 'apps/web/src/app/page.tsx')
  await writeFile(userSource, `${await readFile(userSource, 'utf8')}\n// preserved user source\n`)

  const firstPlan = await planProjectUpdate(target)
  const secondPlan = await updateProject(target, { dryRun: true })
  assert.deepEqual(firstPlan, secondPlan)
  assert.deepEqual(
    firstPlan.changes.map(({ path }) => path),
    ['.cornerstone/manifest.lock.json', 'README.md'],
  )
  assert.match(firstPlan.changes.find(({ path }) => path === 'README.md').diff, /^--- README\.md/m)
  assert.doesNotMatch(
    firstPlan.changes.find(({ path }) => path === 'README.md').diff,
    /secret|credential/i,
  )
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), oldLockBytes)
  assert.equal((await readFile(join(target, 'README.md'), 'utf8')).includes('plan <target>'), false)

  await updateProject(target)
  const updated = await verifyProject(target)
  assert.equal(updated.schemaVersion, 2)
  assert.equal(updated.templateVersion, '0.2.1')
  assert.equal(updated.composers.find(({ id }) => id === 'project-readme').version, 2)
  assert.match(await readFile(join(target, 'README.md'), 'utf8'), /plan <target> --dry-run/)
  assert.match(await readFile(userSource, 'utf8'), /preserved user source/)
  assert.notEqual(updated.integrity, oldLock.integrity)
  await assert.rejects(access(join(target, '.cornerstone/update.journal.json')))

  const noOpPlan = await planProjectUpdate(target)
  assert.equal(noOpPlan.fromTemplateVersion, '0.2.1')
  assert.deepEqual(noOpPlan.changes, [])
  assert.deepEqual((await updateProject(target)).changes, [])
})

test('rejects shared output drift before Standard update writes', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-drift-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const lockBytes = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  await writeFile(join(target, 'README.md'), 'manual edit\n')
  await assert.rejects(planProjectUpdate(target), /shared file was modified.*README\.md/i)
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), lockBytes)
})

test('requires manual migration when a predecessor fragment contract changes', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-fragment-test-'))
  const target = join(fixture, 'project')
  const lock = await makePredecessorStandard(target)
  lock.fragments.find(({ id }) => id === 'web').checksum = digest
  const { integrity: _integrity, ...unsigned } = lock
  lock.integrity = checksum(JSON.stringify(stable(unsigned)))
  await writeFile(join(target, '.cornerstone/manifest.lock.json'), formatJsonDocument(lock))
  await assert.rejects(planProjectUpdate(target), /manual migration required.*fragment web/i)
})

test('rolls back an injected update failure with lock byte identity', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-rollback-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const lockBytes = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  const readmeBytes = await readFile(join(target, 'README.md'))
  injectUpdateFailureForTest('after-output')
  await assert.rejects(updateProject(target), /injected update failure/i)
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), lockBytes)
  assert.deepEqual(await readFile(join(target, 'README.md')), readmeBytes)
  await assert.rejects(access(join(target, '.cornerstone/update.journal.json')))
})

test('recovers a pending update journal before the next plan', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-recovery-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const lockPath = join(target, '.cornerstone/manifest.lock.json')
  const readmePath = join(target, 'README.md')
  const lockBytes = await readFile(lockPath)
  const readmeBytes = await readFile(readmePath)
  const expectedPlan = await planProjectUpdate(target)
  const operationId = '123e4567-e89b-42d3-a456-426614174000'
  const backupRoot = join(target, '.cornerstone/update-backup-fixture')
  await mkdir(join(backupRoot, '.cornerstone'), { recursive: true })
  await writeFile(join(backupRoot, '.cornerstone/manifest.lock.json'), lockBytes)
  await writeFile(join(backupRoot, 'README.md'), readmeBytes)
  await writeFile(
    join(target, '.cornerstone/update.journal.json'),
    formatJsonDocument({
      schemaVersion: 1,
      operationId,
      backupRoot: `.cornerstone/update-backup-${operationId}`,
      status: 'pending',
      entries: [
        {
          path: '.cornerstone/manifest.lock.json',
          backupPath: `.cornerstone/update-backup-${operationId}/.cornerstone/manifest.lock.json`,
          beforeChecksum: checksum(lockBytes),
          afterChecksum: expectedPlan.changes.find(
            ({ path }) => path === '.cornerstone/manifest.lock.json',
          ).afterChecksum,
          beforeMode: 420,
          afterMode: 420,
        },
        {
          path: 'README.md',
          backupPath: `.cornerstone/update-backup-${operationId}/README.md`,
          beforeChecksum: checksum(readmeBytes),
          afterChecksum: expectedPlan.changes.find(({ path }) => path === 'README.md')
            .afterChecksum,
          beforeMode: 420,
          afterMode: 420,
        },
      ],
    }),
  )

  await rename(backupRoot, join(target, `.cornerstone/update-backup-${operationId}`))

  const journalBytes = await readFile(join(target, '.cornerstone/update.journal.json'))
  await assert.rejects(planProjectUpdate(target), /pending update journal.*update recovery/i)
  assert.deepEqual(await readFile(join(target, '.cornerstone/update.journal.json')), journalBytes)
  const plan = await updateProject(target)
  assert.notDeepEqual(await readFile(lockPath), lockBytes)
  assert.equal((await verifyProject(target)).templateVersion, '0.2.1')
  assert.match(await readFile(readmePath, 'utf8'), /plan <target> --dry-run/)
  assert.deepEqual(
    plan.changes.map(({ path }) => path),
    ['.cornerstone/manifest.lock.json', 'README.md'],
  )
  await assert.rejects(access(join(target, '.cornerstone/update.journal.json')))
})

test('rejects concurrent shared-file drift between planning and backup', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-race-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const lockBytes = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  setUpdateHookForTest(async (point) => {
    if (point === 'before-backup') {
      const backup = (await readdir(join(target, '.cornerstone'))).find((entry) =>
        entry.startsWith('update-backup-'),
      )
      assert.ok(backup)
      assert.equal((await stat(join(target, '.cornerstone', backup))).mode & 0o777, 0o700)
      await writeFile(join(target, 'README.md'), 'concurrent edit\n')
    }
  })
  try {
    await assert.rejects(updateProject(target), /source changed after planning.*README\.md/i)
  } finally {
    setUpdateHookForTest(undefined)
  }
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), lockBytes)
  assert.equal(await readFile(join(target, 'README.md'), 'utf8'), 'concurrent edit\n')
  assert.equal(
    (await readdir(join(target, '.cornerstone'))).some((entry) =>
      entry.startsWith('update-backup-'),
    ),
    false,
  )
})

test('rejects a manipulated update journal without touching unrelated files', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-journal-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const operationId = '123e4567-e89b-42d3-a456-426614174001'
  const unrelated = join(target, 'apps/web/src/app/page.tsx')
  const unrelatedBytes = await readFile(unrelated)
  const backupRoot = join(target, `.cornerstone/update-backup-${operationId}`)
  await mkdir(join(backupRoot, 'apps/web/src/app'), { recursive: true })
  await writeFile(join(backupRoot, 'apps/web/src/app/page.tsx'), unrelatedBytes)
  const journalPath = join(target, '.cornerstone/update.journal.json')
  await writeFile(
    journalPath,
    formatJsonDocument({
      schemaVersion: 1,
      operationId,
      backupRoot: `.cornerstone/update-backup-${operationId}`,
      status: 'pending',
      entries: [
        {
          path: 'apps/web/src/app/page.tsx',
          backupPath: `.cornerstone/update-backup-${operationId}/apps/web/src/app/page.tsx`,
          beforeChecksum: checksum(unrelatedBytes),
          afterChecksum: checksum('malicious'),
          beforeMode: 420,
          afterMode: 420,
        },
      ],
    }),
  )

  const journalBytes = await readFile(journalPath)
  await assert.rejects(planProjectUpdate(target), /pending update journal/i)
  assert.deepEqual(await readFile(journalPath), journalBytes)
  await assert.rejects(updateProject(target), /invalid update journal/i)
  assert.deepEqual(await readFile(unrelated), unrelatedBytes)
  assert.deepEqual(await readFile(journalPath), journalBytes)
  assert.equal((await stat(backupRoot)).isDirectory(), true)
})

test('rejects a self-claimed backup for an allowed composer output', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-bound-journal-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const plan = await planProjectUpdate(target)
  const operationId = '123e4567-e89b-42d3-a456-426614174011'
  const relativeRoot = `.cornerstone/update-backup-${operationId}`
  const backupRoot = join(target, relativeRoot)
  const oldLock = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  const originalPackage = await readFile(join(target, 'package.json'))
  const maliciousPackage = Buffer.from('{"scripts":{"owned":"true"}}\n')
  await mkdir(join(backupRoot, '.cornerstone'), { recursive: true, mode: 0o700 })
  await writeFile(join(backupRoot, '.cornerstone/manifest.lock.json'), oldLock)
  await writeFile(join(backupRoot, 'package.json'), maliciousPackage)
  await writeFile(
    join(target, '.cornerstone/update.journal.json'),
    formatJsonDocument({
      schemaVersion: 1,
      operationId,
      backupRoot: relativeRoot,
      status: 'pending',
      entries: [
        {
          path: '.cornerstone/manifest.lock.json',
          backupPath: `${relativeRoot}/.cornerstone/manifest.lock.json`,
          beforeChecksum: checksum(oldLock),
          afterChecksum: plan.changes.find(({ path }) => path === '.cornerstone/manifest.lock.json')
            .afterChecksum,
          beforeMode: 420,
          afterMode: 420,
        },
        {
          path: 'package.json',
          backupPath: `${relativeRoot}/package.json`,
          beforeChecksum: checksum(maliciousPackage),
          afterChecksum: checksum(originalPackage),
          beforeMode: 420,
          afterMode: 420,
        },
      ],
    }),
  )
  await assert.rejects(updateProject(target), /exact expected change set/i)
  assert.deepEqual(await readFile(join(target, 'package.json')), originalPackage)
  assert.deepEqual(await readFile(join(backupRoot, 'package.json')), maliciousPackage)
})

test('cleans a committed update journal with a missing backup before an idempotent plan', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-committed-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const plan = await planProjectUpdate(target)
  const oldLock = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  const oldReadme = await readFile(join(target, 'README.md'))
  await updateProject(target)

  const operationId = '123e4567-e89b-42d3-a456-426614174002'
  const backupRoot = join(target, `.cornerstone/update-backup-${operationId}`)
  await mkdir(join(backupRoot, '.cornerstone'), { recursive: true })
  await writeFile(join(backupRoot, '.cornerstone/manifest.lock.json'), oldLock)
  await writeFile(join(backupRoot, 'README.md'), oldReadme)
  await writeFile(
    join(target, '.cornerstone/update.journal.json'),
    formatJsonDocument({
      schemaVersion: 1,
      operationId,
      backupRoot: `.cornerstone/update-backup-${operationId}`,
      status: 'committed',
      entries: [
        {
          path: '.cornerstone/manifest.lock.json',
          backupPath: `.cornerstone/update-backup-${operationId}/.cornerstone/manifest.lock.json`,
          beforeChecksum: checksum(oldLock),
          afterChecksum: plan.changes.find(({ path }) => path === '.cornerstone/manifest.lock.json')
            .afterChecksum,
          beforeMode: 420,
          afterMode: 420,
        },
        {
          path: 'README.md',
          backupPath: `.cornerstone/update-backup-${operationId}/README.md`,
          beforeChecksum: checksum(oldReadme),
          afterChecksum: plan.changes.find(({ path }) => path === 'README.md').afterChecksum,
          beforeMode: 420,
          afterMode: 420,
        },
      ],
    }),
  )
  await rename(backupRoot, `${backupRoot}.lost-after-commit`)

  assert.deepEqual((await updateProject(target)).changes, [])
  await assert.rejects(access(join(target, '.cornerstone/update.journal.json')))
  await assert.rejects(access(backupRoot))
})

test('cleans a preparing journal without restoring partial backups', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-preparing-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const oldReadme = await readFile(join(target, 'README.md'))
  const plan = await planProjectUpdate(target)
  const operationId = '123e4567-e89b-42d3-a456-426614174003'
  const backupRoot = join(target, `.cornerstone/update-backup-${operationId}`)
  await mkdir(backupRoot, { recursive: false, mode: 0o700 })
  await writeFile(join(backupRoot, 'README.md'), oldReadme)
  await writeFile(
    join(target, '.cornerstone/update.journal.json'),
    formatJsonDocument({
      schemaVersion: 1,
      operationId,
      backupRoot: `.cornerstone/update-backup-${operationId}`,
      status: 'preparing',
      entries: [
        {
          path: 'README.md',
          backupPath: `.cornerstone/update-backup-${operationId}/README.md`,
          beforeChecksum: checksum(oldReadme),
          afterChecksum: plan.changes.find(({ path }) => path === 'README.md').afterChecksum,
          beforeMode: 420,
          afterMode: 420,
        },
      ],
    }),
  )

  await updateProject(target)
  assert.match(await readFile(join(target, 'README.md'), 'utf8'), /plan <target> --dry-run/)
  assert.equal((await verifyProject(target)).templateVersion, '0.2.1')
  await assert.rejects(access(backupRoot))
  await assert.rejects(access(join(target, '.cornerstone/update.journal.json')))
})

test('never rolls back after the committed journal boundary', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-post-commit-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  injectUpdateFailureForTest('after-commit-before-cleanup')
  await assert.rejects(updateProject(target), /after-commit-before-cleanup/i)

  assert.equal((await verifyProject(target)).templateVersion, '0.2.1')
  const journalPath = join(target, '.cornerstone/update.journal.json')
  assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).status, 'committed')
  assert.deepEqual((await updateProject(target)).changes, [])
  await assert.rejects(access(journalPath))
})

test('removes update temp files when replacement fails', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-temp-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const oldLock = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  injectUpdateFailureForTest('before-temp-rename')
  await assert.rejects(updateProject(target), /before-temp-rename/i)
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), oldLock)
  assert.equal(
    (await readdir(join(target, '.cornerstone'))).some((entry) => entry.endsWith('.tmp')),
    false,
  )
  await assert.rejects(access(join(target, '.cornerstone/update.journal.json')))
})

test('serializes actual updates with a project-scoped operation lock', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-lock-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  let release
  let entered
  const enteredPromise = new Promise((resolve) => (entered = resolve))
  const releasePromise = new Promise((resolve) => (release = resolve))
  setUpdateHookForTest(async (point) => {
    if (point === 'before-backup') {
      entered()
      await releasePromise
    }
  })
  const first = updateProject(target)
  await enteredPromise
  await assert.rejects(updateProject(target), /another update operation|stale update lock/i)
  release()
  try {
    await first
  } finally {
    setUpdateHookForTest(undefined)
  }
  assert.equal((await verifyProject(target)).templateVersion, '0.2.1')
  await assert.rejects(access(join(target, '.cornerstone/update.lock')))
})

test('does not automatically remove a stale update operation lock', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-stale-lock-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const stale = join(target, '.cornerstone/update.lock')
  await mkdir(stale, { mode: 0o700 })
  await writeFile(join(stale, 'owner.json'), '{"pid":999999}\n')
  await assert.rejects(updateProject(target), /stale update lock/i)
  assert.equal((await stat(stale)).isDirectory(), true)
  assert.equal((await planProjectUpdate(target)).fromTemplateVersion, '0.2.0')
})

test('rejects a cornerstone symlink without touching its outside target', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-symlink-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const outside = join(fixture, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'preserve.txt'), 'outside\n')
  await rename(join(target, '.cornerstone'), join(target, '.cornerstone-real'))
  await symlink(outside, join(target, '.cornerstone'))
  await assert.rejects(planProjectUpdate(target), /\.cornerstone must be a real directory/i)
  await assert.rejects(updateProject(target), /\.cornerstone must be a real directory/i)
  assert.equal(await readFile(join(outside, 'preserve.txt'), 'utf8'), 'outside\n')
})

test('rejects predecessor baseline drift even with self-consistent lock integrity', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-contract-test-'))
  const target = join(fixture, 'project')
  const lock = await makePredecessorStandard(target)
  lock.baselines.openapi = '9.9.9'
  const { integrity: _integrity, ...unsigned } = lock
  lock.integrity = checksum(JSON.stringify(stable(unsigned)))
  await writeFile(join(target, '.cornerstone/manifest.lock.json'), formatJsonDocument(lock))
  await assert.rejects(planProjectUpdate(target), /predecessor release contract changed/i)
})

test('best-effort drift detection preserves an edit made immediately before output rename', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-drift-window-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const lockBytes = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  let changed = false
  setUpdateHookForTest(async (point, path) => {
    if (!changed && point === 'before-temp-rename' && path === 'README.md') {
      changed = true
      await writeFile(join(target, 'README.md'), 'concurrent edit before rename\n')
    }
  })
  try {
    await assert.rejects(updateProject(target), /concurrent modification|replacement precondition/i)
  } finally {
    setUpdateHookForTest(undefined)
  }
  assert.equal(await readFile(join(target, 'README.md'), 'utf8'), 'concurrent edit before rename\n')
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), lockBytes)
  assert.equal(
    (await readdir(target)).some((entry) => entry.endsWith('.tmp')),
    false,
  )
})

test('actual update rejects an unsafe POSIX ownership boundary while dry-run remains read-only', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permissions only')
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-permission-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  await chmod(target, 0o777)
  assert.equal((await planProjectUpdate(target)).fromTemplateVersion, '0.2.0')
  await assert.rejects(updateProject(target), /write ancestor.*group\/world writable/i)
  await chmod(target, 0o700)
})

test('actual update rejects an unsafe generator-owned output ancestor while dry-run can inspect', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permissions only')
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-output-parent-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const workflows = join(target, '.github/workflows')
  await chmod(workflows, 0o777)
  assert.equal((await planProjectUpdate(target)).fromTemplateVersion, '0.2.0')
  await assert.rejects(updateProject(target), /write ancestor.*group\/world writable/i)
  await chmod(workflows, 0o755)
})

test('rejects a writable non-sticky target parent but accepts an owned child under sticky temp', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permissions only')
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-parent-chain-test-'))
  const unsafeTarget = join(fixture, 'unsafe-project')
  await makePredecessorStandard(unsafeTarget)
  await chmod(fixture, 0o777)
  assert.equal((await planProjectUpdate(unsafeTarget)).fromTemplateVersion, '0.2.0')
  await assert.rejects(updateProject(unsafeTarget), /writable non-sticky directory/i)
  await chmod(fixture, 0o700)

  const sticky = join(fixture, 'sticky')
  await mkdir(sticky)
  await chmod(sticky, 0o1777)
  const stickyTarget = join(sticky, 'project')
  await makePredecessorStandard(stickyTarget)
  assert.equal((await updateProject(stickyTarget)).toTemplateVersion, '0.2.1')
  assert.equal((await verifyProject(stickyTarget)).templateVersion, '0.2.1')
})

test('canonicalizes a lexical symlink ancestor before planning and update writes', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-canonical-target-test-'))
  const realParent = join(fixture, 'real-parent')
  await mkdir(realParent)
  const target = join(realParent, 'project')
  await makePredecessorStandard(target)
  const alias = join(fixture, 'alias-parent')
  await symlink(realParent, alias)
  const lexicalTarget = join(alias, 'project')
  const outside = join(fixture, 'outside-preserve.txt')
  await writeFile(outside, 'preserve\n')

  const canonicalTarget = await realpath(target)
  assert.equal((await planProjectUpdate(lexicalTarget)).target, canonicalTarget)
  assert.equal((await updateProject(lexicalTarget)).target, canonicalTarget)
  assert.equal((await verifyProject(canonicalTarget)).templateVersion, '0.2.1')
  assert.equal(await readFile(outside, 'utf8'), 'preserve\n')
})

test('parent ownership policy rejects a foreign uid even when its mode is 0755', () => {
  const effectiveUserId = 501
  assert.equal(
    isTrustedUpdateParentPolicy({
      parentUserId: 777,
      parentMode: 0o755,
      childUserId: effectiveUserId,
      effectiveUserId,
    }),
    false,
  )
  assert.equal(
    isTrustedUpdateParentPolicy({
      parentUserId: 0,
      parentMode: 0o755,
      childUserId: 0,
      effectiveUserId,
    }),
    true,
  )
  assert.equal(
    isTrustedUpdateParentPolicy({
      parentUserId: 0,
      parentMode: 0o1777,
      childUserId: effectiveUserId,
      effectiveUserId,
    }),
    true,
  )
})

test('rejects oversized generator-owned output and backup before buffering', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-size-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  await writeFile(join(target, 'README.md'), Buffer.alloc(16 * 1024 * 1024 + 1, 0x61))
  await assert.rejects(planProjectUpdate(target), /16 MiB input limit/i)

  await makePredecessorStandard(join(fixture, 'backup-project'))
  const backupTarget = join(fixture, 'backup-project')
  let oversizedBackup
  setUpdateHookForTest(async (point) => {
    if (point === 'after-output') {
      const root = (await readdir(join(backupTarget, '.cornerstone'))).find((entry) =>
        entry.startsWith('update-backup-'),
      )
      oversizedBackup = join(backupTarget, '.cornerstone', root, 'README.md')
      await writeFile(oversizedBackup, Buffer.alloc(16 * 1024 * 1024 + 1, 0x62))
      throw new Error('force oversized backup rollback')
    }
  })
  try {
    await assert.rejects(updateProject(backupTarget), /16 MiB input limit/i)
  } finally {
    setUpdateHookForTest(undefined)
  }
  assert.equal((await stat(oversizedBackup)).size, 16 * 1024 * 1024 + 1)
})

test('recovers a durable rolled-back journal after backup cleanup interruption', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-rolled-back-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const oldLock = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  const oldReadme = await readFile(join(target, 'README.md'))
  setUpdateHookForTest(async (point) => {
    if (point === 'after-output') throw new Error('force rollback')
    if (point === 'after-rollback-backup-cleanup') {
      throw new Error('interrupt rollback cleanup')
    }
  })
  try {
    await assert.rejects(updateProject(target), /interrupt rollback cleanup/i)
  } finally {
    setUpdateHookForTest(undefined)
  }
  const journalPath = join(target, '.cornerstone/update.journal.json')
  assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).status, 'rolled-back')
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), oldLock)
  assert.deepEqual(await readFile(join(target, 'README.md')), oldReadme)
  assert.deepEqual((await updateProject(target)).toTemplateVersion, '0.2.1')
  await assert.rejects(access(journalPath))
})

test('preserves a replaced operation lock instead of deleting another owner lock', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-lock-identity-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  const lockPath = join(target, '.cornerstone/update.lock')
  setUpdateHookForTest(async (point) => {
    if (point === 'before-operation-lock-cleanup') {
      await rm(lockPath, { recursive: true })
      await mkdir(lockPath, { mode: 0o700 })
      await writeFile(join(lockPath, 'owner.json'), 'replacement\n', { mode: 0o600 })
    }
  })
  try {
    await assert.rejects(updateProject(target), /lock ownership changed.*preserved/i)
  } finally {
    setUpdateHookForTest(undefined)
  }
  assert.equal(await readFile(join(lockPath, 'owner.json'), 'utf8'), 'replacement\n')
})

test('rejects chmod-only drift during rollback instead of overwriting it', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-update-mode-drift-test-'))
  const target = join(fixture, 'project')
  await makePredecessorStandard(target)
  setUpdateHookForTest(async (point) => {
    if (point === 'after-output') {
      await chmod(join(target, 'README.md'), 0o600)
      throw new Error('force rollback after chmod drift')
    }
  })
  try {
    await assert.rejects(updateProject(target), /concurrent modification.*README\.md/i)
  } finally {
    setUpdateHookForTest(undefined)
  }
  assert.equal((await stat(join(target, 'README.md'))).mode & 0o777, 0o600)
  assert.equal(
    JSON.parse(await readFile(join(target, '.cornerstone/update.journal.json'), 'utf8')).status,
    'pending',
  )
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

test('plans without writes and applies Journal v2 add and modify with lock last', async () => {
  const { target, request, beforeLock, afterLock, afterShared } = await makeMutationFixture()
  const beforeNames = await readdir(target, { recursive: true })
  const plan = await planGeneratorMutation(target, request)
  assert.deepEqual(
    plan.changes.map(({ action }) => action),
    ['add', 'modify', 'modify'],
  )
  assert.deepEqual(await readdir(target, { recursive: true }), beforeNames)
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), beforeLock)
  assert.deepEqual(
    (await applyGeneratorMutation(target, request, { dryRun: true })).changes,
    plan.changes,
  )

  const writeOrder = []
  setUpdateHookForTest((point, path) => {
    if (point === 'mutation-after-write') writeOrder.push(path)
  })
  try {
    await applyGeneratorMutation(target, request)
  } finally {
    setUpdateHookForTest(undefined)
  }
  assert.equal(writeOrder.at(-1), '.cornerstone/manifest.lock.json')
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), afterLock)
  assert.deepEqual(await readFile(join(target, 'shared/config.json')), afterShared)
  assert.equal(
    await readFile(join(target, 'packages/example/src/index.ts'), 'utf8'),
    'export const generated = true\n',
  )
  for (const directory of ['packages', 'packages/example', 'packages/example/src']) {
    assert.equal((await stat(join(target, directory))).mode & 0o777, 0o755)
  }
  await assert.rejects(access(join(target, '.cornerstone/mutation.journal.json')))
})

test('recovers Journal v2 preparing and committed crash boundaries', async () => {
  {
    const { target, request, afterLock } = await makeMutationFixture()
    injectUpdateFailureForTest('mutation-crash-after-journal')
    await assert.rejects(applyGeneratorMutation(target, request), /injected mutation crash/i)
    assert.equal(
      JSON.parse(await readFile(join(target, '.cornerstone/mutation.journal.json'), 'utf8')).status,
      'preparing',
    )
    await applyGeneratorMutation(target, request)
    assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), afterLock)
  }
  {
    const { target, request, afterLock } = await makeMutationFixture()
    injectUpdateFailureForTest('mutation-crash-after-commit')
    await assert.rejects(applyGeneratorMutation(target, request), /injected mutation crash/i)
    assert.equal(
      JSON.parse(await readFile(join(target, '.cornerstone/mutation.journal.json'), 'utf8')).status,
      'committed',
    )
    await applyGeneratorMutation(target, request)
    assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), afterLock)
    await assert.rejects(access(join(target, '.cornerstone/mutation.journal.json')))
  }
})

test('rolls back Journal v2 add and modify failure and removes generated empty parents', async () => {
  const { target, request, beforeLock, beforeShared } = await makeMutationFixture()
  setUpdateHookForTest((point, path) => {
    if (point === 'mutation-after-write' && path === 'shared/config.json') {
      throw new Error('injected mid-apply failure')
    }
  })
  try {
    await assert.rejects(applyGeneratorMutation(target, request), /injected mid-apply failure/i)
  } finally {
    setUpdateHookForTest(undefined)
  }
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), beforeLock)
  assert.deepEqual(await readFile(join(target, 'shared/config.json')), beforeShared)
  await assert.rejects(access(join(target, 'packages/example/src/index.ts')))
  await assert.rejects(access(join(target, 'packages')))
})

test('preserves drifted Journal v2 add output and fails closed during rollback', async () => {
  const { target, request } = await makeMutationFixture()
  setUpdateHookForTest(async (point, path) => {
    if (point === 'mutation-after-write' && path === 'packages/example/src/index.ts') {
      await writeFile(join(target, path), 'user drift\n')
    }
  })
  injectUpdateFailureForTest('mutation-after-output')
  try {
    await assert.rejects(applyGeneratorMutation(target, request), /precondition changed/i)
  } finally {
    setUpdateHookForTest(undefined)
    injectUpdateFailureForTest(undefined)
  }
  assert.equal(
    await readFile(join(target, 'packages/example/src/index.ts'), 'utf8'),
    'user drift\n',
  )
})

test('recovers a crashed pending Journal v2 before reapplying the exact request', async () => {
  const { target, request, afterLock } = await makeMutationFixture()
  injectUpdateFailureForTest('mutation-crash-after-output')
  await assert.rejects(applyGeneratorMutation(target, request), /injected mutation crash/i)
  assert.equal(
    JSON.parse(await readFile(join(target, '.cornerstone/mutation.journal.json'), 'utf8')).status,
    'pending',
  )
  await applyGeneratorMutation(target, request)
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), afterLock)
  await assert.rejects(access(join(target, '.cornerstone/mutation.journal.json')))
})

test('recovers durable Journal v2 rolled-back cleanup after a crash', async () => {
  const { target, request, afterLock } = await makeMutationFixture()
  setUpdateHookForTest((point) => {
    if (point === 'mutation-before-rollback') {
      injectUpdateFailureForTest('mutation-crash-after-rollback')
    }
  })
  injectUpdateFailureForTest('mutation-after-output')
  try {
    await assert.rejects(applyGeneratorMutation(target, request), /injected mutation crash/i)
  } finally {
    setUpdateHookForTest(undefined)
    injectUpdateFailureForTest(undefined)
  }
  const journalPath = join(target, '.cornerstone/mutation.journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8'))
  assert.equal(journal.status, 'rolled-back')
  await access(join(target, journal.backupRoot))
  await access(join(target, 'packages'))

  await applyGeneratorMutation(target, request)
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), afterLock)
  await assert.rejects(access(journalPath))
  await assert.rejects(access(join(target, journal.backupRoot)))
})

test('rejects malicious Journal v2 and keeps unrelated files unchanged', async () => {
  const { target, request } = await makeMutationFixture()
  injectUpdateFailureForTest('mutation-crash-after-output')
  await assert.rejects(applyGeneratorMutation(target, request), /injected mutation crash/i)
  const unrelated = join(target, 'unrelated.txt')
  await writeFile(unrelated, 'preserve\n')
  const journalPath = join(target, '.cornerstone/mutation.journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8'))
  journal.entries[1].backupPath = 'unrelated.txt'
  await writeFile(journalPath, formatJsonDocument(journal))
  await assert.rejects(
    applyGeneratorMutation(target, request),
    /invalid mutation journal v2 entry/i,
  )
  assert.equal(await readFile(unrelated, 'utf8'), 'preserve\n')
})

test('rejects Journal v2 created directory injection without deleting an existing ancestor', async () => {
  const { target, request } = await makeMutationFixture()
  await mkdir(join(target, 'packages'))
  const requestWithExistingParent = {
    ...request,
    createdDirectories: ['packages/example', 'packages/example/src'],
  }
  injectUpdateFailureForTest('mutation-crash-after-output')
  await assert.rejects(
    applyGeneratorMutation(target, requestWithExistingParent),
    /injected mutation crash/i,
  )
  const journalPath = join(target, '.cornerstone/mutation.journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8'))
  journal.createdDirectories.unshift('packages')
  await writeFile(journalPath, formatJsonDocument(journal))
  await assert.rejects(
    applyGeneratorMutation(target, requestWithExistingParent),
    /created directories do not match the exact request/i,
  )
  assert.deepEqual(await readdir(join(target, 'packages')), ['example'])
})

test('parses delete Journal v2 entries but rejects delete execution and unsafe requests', async () => {
  const operationId = '12345678-1234-4234-8234-123456789abc'
  const journal = {
    schemaVersion: 2,
    operationId,
    operationKind: 'generate',
    backupRoot: `.cornerstone/mutation-backup-${operationId}`,
    status: 'pending',
    createdDirectories: [],
    entries: [
      {
        action: 'delete',
        path: 'src/old.ts',
        backupPath: `.cornerstone/mutation-backup-${operationId}/src/old.ts`,
        beforeChecksum: digest,
        beforeMode: 0o644,
        afterChecksum: null,
        afterMode: null,
      },
      {
        action: 'modify',
        path: '.cornerstone/manifest.lock.json',
        backupPath: `.cornerstone/mutation-backup-${operationId}/.cornerstone/manifest.lock.json`,
        beforeChecksum: digest,
        beforeMode: 0o644,
        afterChecksum: digest,
        afterMode: 0o644,
      },
    ],
  }
  assert.equal(parseMutationJournalV2(journal).entries[0].action, 'delete')
  const { target, request } = await makeMutationFixture()
  await assert.rejects(
    planGeneratorMutation(target, {
      ...request,
      entries: [
        ...request.entries,
        {
          action: 'delete',
          path: 'src/old.ts',
          beforeChecksum: digest,
          beforeMode: 0o644,
        },
      ],
    }),
    /delete execution is reserved/i,
  )
  await assert.rejects(
    planGeneratorMutation(target, { ...request, lockPath: 'other.lock' }),
    /lock path must be the manifest lock/i,
  )
  await assert.rejects(
    planGeneratorMutation(target, { ...request, createdDirectories: [] }),
    /exact missing add ancestors/i,
  )
  await assert.rejects(
    planGeneratorMutation(target, {
      ...request,
      entries: [...request.entries, { ...request.entries[0], path: 'PACKAGES/EXAMPLE' }],
    }),
    /portable or ancestor collision/i,
  )
})

test('plans and generates all four canonical Lock v3 scaffold kinds', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-scaffold-generator-test-'))
  const target = join(fixture, 'project')
  await createProjectFromManifest(target, {
    schemaVersion: 1,
    name: 'scaffold-generator-app',
    profile: 'standard',
  })
  const cases = [
    ['package', '@example/generated', {}],
    ['feature', 'billing', {}],
    ['api', 'reports', {}],
    ['migration', 'AddReports', { timestamp: '1786579400000' }],
  ]
  for (const [kind, name, options] of cases) {
    const lockBefore = await readFile(join(target, '.cornerstone/manifest.lock.json'))
    const first = await planScaffoldGeneration(target, kind, name, options)
    const second = await planScaffoldGeneration(target, kind, name, options)
    assert.deepEqual(first, second)
    assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), lockBefore)
    assert.equal(first.changes.at(-1).path, '.cornerstone/manifest.lock.json')
    const generated = await generateScaffold(target, kind, name, options)
    assert.deepEqual(generated.changes, first.changes)
    const verified = await verifyProject(target)
    assert.equal(verified.schemaVersion, 3)
    assert.equal(
      verified.scaffolds.some(({ id }) => id === `${kind}:${name}`),
      true,
    )
  }
  const appModule = await readFile(join(target, 'apps/api/src/app.module.ts'), 'utf8')
  assert.match(appModule, /BillingModule/)
  assert.doesNotMatch(appModule, /ReportsModule/)
  assert.doesNotMatch(
    await readFile(join(target, 'apps/api/src/contracts/api-contract.module.ts'), 'utf8'),
    /ReportsContractController/,
  )
  assert.match(
    await readFile(
      join(target, 'apps/api/src/database/migrations/1786579400000-AddReports.ts'),
      'utf8',
    ),
    /implementation required before execution/,
  )
  const migrationMetadata = JSON.parse(
    await readFile(
      join(target, 'apps/api/src/database/migrations/1786579400000-AddReports.metadata.json'),
      'utf8',
    ),
  )
  assert.deepEqual(migrationMetadata.abortConditions, ['implementation_review_not_completed'])
  const finalLock = await verifyProject(target)
  const prettier = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    [
      'exec',
      'prettier',
      '--check',
      ...cases.flatMap(([kind, name]) => {
        const entry = finalLock.scaffolds.find(({ id }) => id === `${kind}:${name}`)
        return (entry?.paths ?? []).map((path) => join(target, path))
      }),
      join(target, 'apps/api/src/app.module.ts'),
      join(target, 'apps/api/src/contracts/api-contract.module.ts'),
    ],
    { cwd: new URL('../../..', import.meta.url), encoding: 'utf8' },
  )
  assert.equal(prettier.status, 0, `${prettier.stdout}${prettier.stderr}`)
})

test('rejects duplicate scaffold generation and preserves the lock on rollback', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-scaffold-rollback-test-'))
  const target = join(fixture, 'project')
  await createProjectFromManifest(target, {
    schemaVersion: 1,
    name: 'scaffold-rollback-app',
    profile: 'standard',
  })
  const before = await readFile(join(target, '.cornerstone/manifest.lock.json'))
  injectUpdateFailureForTest('mutation-after-output')
  await assert.rejects(generateScaffold(target, 'feature', 'billing'), /injected update failure/i)
  assert.deepEqual(await readFile(join(target, '.cornerstone/manifest.lock.json')), before)
  await assert.rejects(access(join(target, 'apps/api/src/billing/billing.module.ts')))
  await generateScaffold(target, 'feature', 'billing')
  await assert.rejects(generateScaffold(target, 'feature', 'billing'), /already exists/i)
})

test('rejects non-canonical scaffold options and strict CLI generate arguments', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-scaffold-cli-test-'))
  const target = join(fixture, 'project')
  await createProjectFromManifest(target, {
    schemaVersion: 1,
    name: 'scaffold-cli-app',
    profile: 'standard',
  })
  await assert.rejects(
    planScaffoldGeneration(target, 'migration', 'AddReports'),
    /requires --timestamp/i,
  )
  await assert.rejects(
    planScaffoldGeneration(target, 'feature', 'billing', { timestamp: '1786579400000' }),
    /does not accept options/i,
  )
  for (const invalidName of ['billing-', 'billing--report']) {
    await assert.rejects(
      planScaffoldGeneration(target, 'feature', invalidName),
      /invalid feature scaffold name/i,
    )
  }
  await generateScaffold(target, 'migration', 'AddReports', {
    timestamp: '1786579400000',
  })
  await assert.rejects(
    planScaffoldGeneration(target, 'migration', 'AddInvoices', {
      timestamp: '1786579400000',
    }),
    /duplicate migration timestamp/i,
  )
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
  for (const args of [
    ['generate', 'feature', 'billing', '--target', target, '--unknown'],
    ['generate', 'feature', 'billing', '--target', target, '--target', target],
    ['generate', 'feature', 'billing', target],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`)
  }
  const dryRun = spawnSync(
    process.execPath,
    [cli, 'generate', 'feature', 'billing', '--target', target, '--dry-run'],
    { encoding: 'utf8' },
  )
  assert.equal(dryRun.status, 0, `${dryRun.stdout}${dryRun.stderr}`)
  assert.match(dryRun.stdout, /feature:billing/)
  await assert.rejects(access(join(target, 'apps/api/src/billing/billing.module.ts')))
})
