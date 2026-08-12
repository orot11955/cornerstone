import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const artifacts = join(root, '.artifacts', 'generator')
const fixture = mkdtempSync(join(tmpdir(), 'cornerstone-generator-consumer-'))

rmSync(artifacts, { recursive: true, force: true })
mkdirSync(artifacts, { recursive: true })

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, CI: '1' },
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

run('pnpm', ['--filter', 'create-cornerstone', 'build'])
const packed = JSON.parse(
  run('pnpm', [
    '--dir',
    'packages/create-cornerstone',
    'pack',
    '--pack-destination',
    artifacts,
    '--json',
  ]),
)
const filename = packed.filename ?? packed[0]?.filename
if (!filename) throw new Error('create-cornerstone pack did not return a filename')
const tarball = resolve('packages/create-cornerstone', filename)

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
writeFileSync(
  join(fixture, 'cornerstone.config.yml'),
  'schemaVersion: 1\nname: generated-app\nprofile: minimal\nlicense: ISC\n',
)
run('pnpm', ['install', '--ignore-workspace'], fixture)

for (const target of ['project-a', 'project-b']) {
  run(
    'pnpm',
    ['exec', 'create-cornerstone', 'create', target, '--manifest', 'cornerstone.config.yml'],
    fixture,
  )
  run('pnpm', ['exec', 'create-cornerstone', 'verify', target], fixture)
  run('pnpm', ['install', '--frozen-lockfile', '--offline'], join(fixture, target))
  run('pnpm', ['typecheck'], join(fixture, target))
  run('pnpm', ['build'], join(fixture, target))
  run('pnpm', ['test'], join(fixture, target))
}

function digestDirectory(directory) {
  const hash = createHash('sha256')
  function visit(current, relative = '') {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (['node_modules', 'dist'].includes(entry.name)) continue
      const path = join(current, entry.name)
      const name = join(relative, entry.name)
      if (entry.isDirectory()) visit(path, name)
      else if (entry.isFile()) hash.update(`${name}\0`).update(readFileSync(path))
      else throw new Error(`Generated project contains unsupported entry: ${name}`)
    }
  }
  visit(directory)
  return `sha256:${hash.digest('hex')}`
}

const firstDigest = digestDirectory(join(fixture, 'project-a'))
const secondDigest = digestDirectory(join(fixture, 'project-b'))
if (firstDigest !== secondDigest) throw new Error('Generated projects are not byte-stable')

const generatedFiles = readdirSync(join(fixture, 'project-a'), { recursive: true })
  .map(String)
  .sort()
if (generatedFiles.some((file) => /(auth|database|observability|privacy)/i.test(file))) {
  throw new Error('Minimal profile contains an unselected capability')
}

writeFileSync(
  join(artifacts, 'generator-consumer-report.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      profile: 'minimal',
      byteStableDigest: firstDigest,
      frozenInstall: 'passed',
      typecheck: 'passed',
      build: 'passed',
      test: 'passed',
      unselectedCapabilityFiles: 0,
    },
    null,
    2,
  )}\n`,
)

console.log('Generator consumer verification: OK (minimal profile)')
