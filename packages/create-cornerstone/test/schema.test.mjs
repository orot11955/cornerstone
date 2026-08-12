import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stringify } from 'yaml'
import { createProject, resolveManifest, verifyProject } from '../dist/index.js'

test('resolves the minimal profile without optional capabilities', () => {
  assert.deepEqual(
    resolveManifest({ schemaVersion: 1, name: 'sample-app', profile: 'minimal' }).capabilities,
    [],
  )
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

test('does not generate a profile before its fragments are certified', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'cornerstone-create-test-'))
  const manifestPath = join(fixture, 'manifest.yml')
  await writeFile(
    manifestPath,
    stringify({ schemaVersion: 1, name: 'sample-app', profile: 'standard' }),
  )
  await assert.rejects(
    createProject(join(fixture, 'project'), manifestPath),
    /only certifies the minimal profile/,
  )
  await assert.rejects(readdir(join(fixture, 'project')))
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
  await assert.rejects(verifyProject(target), /integrity/)
})
