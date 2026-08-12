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
  planProjectUpdate,
  projectLockSchema,
  canonicalTemplateMetadataSchema,
  resolveCapabilities,
  resolveManifest,
  validateCanonicalOwnership,
  verifyProject,
  updateProject,
} from '../dist/index.js'
import {
  injectUpdateFailureForTest,
  isTrustedUpdateParentPolicy,
  setUpdateHookForTest,
} from '../dist/update-internal.js'
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

async function makePredecessorStandard(target, name = 'update-app') {
  const lock = await createProjectFromManifest(target, {
    schemaVersion: 1,
    name,
    profile: 'standard',
  })
  assert.equal(lock.schemaVersion, 2)
  const readme = await readFile(join(target, 'README.md'), 'utf8')
  const predecessorReadme = readme.replace(
    '\nUse `create-cornerstone plan <target> --dry-run` before `create-cornerstone update <target>`; interrupted journaled updates are recovered on the next lifecycle command.\n',
    '',
  )
  await writeFile(join(target, 'README.md'), predecessorReadme)
  lock.templateVersion = '0.2.0'
  const readmeComposer = lock.composers.find(({ id }) => id === 'project-readme')
  readmeComposer.version = 1
  readmeComposer.checksum = checksum(
    JSON.stringify(
      stable({
        definition: {
          id: 'project-readme',
          version: 1,
          format: 'readme',
          output: 'README.md',
        },
        sources: {},
      }),
    ),
  )
  lock.outputs.find(({ path }) => path === 'README.md').checksum = checksum(predecessorReadme)
  const { integrity: _integrity, ...unsigned } = lock
  lock.integrity = checksum(JSON.stringify(stable(unsigned)))
  await writeFile(join(target, '.cornerstone/manifest.lock.json'), formatJsonDocument(lock))
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
