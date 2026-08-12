import { randomUUID } from 'node:crypto'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { sha256, stableJson } from './hash.js'
import {
  projectLockSchema,
  projectManifestSchema,
  resolveManifest,
  type ProjectLockData,
  type ProjectManifest,
  type ResolvedManifest,
} from './schema.js'

const generatorVersion = '0.1.0' as const
const templateVersion = '0.1.0' as const
const templateRoot = resolve(import.meta.dirname, 'templates', 'canonical')

export type ProjectLock = ProjectLockData

export async function readManifest(path: string): Promise<ProjectManifest> {
  return projectManifestSchema.parse(parse(await readFile(path, 'utf8')))
}

export function planProject(manifest: ResolvedManifest) {
  return {
    manifest,
    files: [
      'cornerstone.config.yml',
      'package.json',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'src/index.ts',
      'test/index.test.mjs',
      '.cornerstone/manifest.lock.json',
      ...(manifest.license && manifest.license !== 'UNLICENSED' ? ['LICENSE'] : []),
    ].sort(),
  }
}

export async function createProject(
  targetPath: string,
  manifestPath: string,
): Promise<ProjectLock> {
  const target = resolve(targetPath)
  const userManifest = await readManifest(resolve(manifestPath))
  const manifest = resolveManifest(userManifest)
  assertCertifiedComposition(manifest)
  await assertTargetAvailable(target)

  const staging = join(dirname(target), `.${basename(target)}.cornerstone-staging-${randomUUID()}`)
  let movedEmptyTarget: string | undefined

  try {
    await mkdir(staging, { recursive: false })
    const lock = await writeProject(staging, userManifest, manifest)
    await verifyProject(staging)

    if (await exists(target)) {
      movedEmptyTarget = `${target}.cornerstone-empty-${randomUUID()}`
      await rename(target, movedEmptyTarget)
    }
    await rename(staging, target)
    if (movedEmptyTarget) await rm(movedEmptyTarget, { recursive: true })
    return lock
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (movedEmptyTarget && !(await exists(target))) {
      await rename(movedEmptyTarget, target)
    }
    throw error
  }
}

export async function verifyProject(targetPath: string): Promise<ProjectLock> {
  const target = resolve(targetPath)
  const lockPath = join(target, '.cornerstone', 'manifest.lock.json')
  const lock = projectLockSchema.parse(JSON.parse(await readFile(lockPath, 'utf8')))
  const { integrity, ...unsigned } = lock
  if (sha256(stableJson(unsigned)) !== integrity) {
    throw new Error('Lock manifest integrity mismatch')
  }

  const userManifest = await readManifest(join(target, 'cornerstone.config.yml'))
  if (sha256(stableJson(userManifest)) !== lock.userManifestDigest) {
    throw new Error('User manifest digest does not match the lock manifest')
  }
  const manifest = resolveManifest(userManifest)
  if (stableJson(manifest) !== stableJson(lock.resolved)) {
    throw new Error('Resolved manifest does not match the lock manifest')
  }
  if (stableJson(lock) !== stableJson(await buildLock(userManifest, manifest))) {
    throw new Error('Lock manifest differs from the generator-owned resolution')
  }

  for (const required of planProject(manifest).files) {
    await access(join(target, required))
  }
  return lock
}

async function writeProject(
  target: string,
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
): Promise<ProjectLock> {
  await copyDirectory(join(templateRoot, 'base'), target)
  await mkdir(join(target, '.cornerstone'), { recursive: true })

  await writeFile(
    join(target, 'cornerstone.config.yml'),
    stringify(userManifest, { sortMapEntries: true }),
  )
  await writeFile(
    join(target, 'package.json'),
    `${JSON.stringify(composePackageJson(manifest), null, 2)}\n`,
  )

  if (manifest.license && manifest.license !== 'UNLICENSED') {
    await copyFile(join(templateRoot, 'licenses', manifest.license), join(target, 'LICENSE'))
  }

  const lock = await buildLock(userManifest, manifest)
  const temporaryLock = join(target, '.cornerstone', `manifest.lock.${randomUUID()}.tmp`)
  await writeFile(temporaryLock, `${JSON.stringify(lock, null, 2)}\n`)
  await rename(temporaryLock, join(target, '.cornerstone', 'manifest.lock.json'))
  return lock
}

async function buildLock(
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
): Promise<ProjectLock> {
  const fragments = await Promise.all(
    ['base', ...manifest.capabilities].map(async (id) => ({
      id,
      checksum: await fragmentChecksum(id),
    })),
  )
  const unsigned = {
    schemaVersion: 1 as const,
    generatorVersion,
    templateVersion,
    userManifestDigest: sha256(stableJson(userManifest)),
    resolved: manifest,
    compatibility: {
      node: '>=22.20.0 <25' as const,
      pnpm: '11.20.0' as const,
    },
    fragments,
  }
  const lock: ProjectLock = {
    ...unsigned,
    integrity: sha256(stableJson(unsigned)),
  }
  return lock
}

function composePackageJson(manifest: ResolvedManifest) {
  return {
    name: manifest.name,
    version: '0.1.0',
    private: true,
    ...(manifest.license ? { license: manifest.license } : {}),
    type: 'module',
    packageManager: 'pnpm@11.20.0',
    engines: { node: '>=22.20.0 <25', pnpm: '11.20.0' },
    scripts: {
      build: 'tsc -p tsconfig.json',
      typecheck: 'tsc -p tsconfig.json --noEmit',
      test: 'node --test',
    },
    devDependencies: { typescript: '5.9.3' },
  }
}

function assertCertifiedComposition(manifest: ResolvedManifest): void {
  if (manifest.profile !== 'minimal' || manifest.capabilities.length > 0) {
    throw new Error(
      'Generator 0.1.0 only certifies the minimal profile without additional capabilities',
    )
  }
}

async function assertTargetAvailable(target: string): Promise<void> {
  if (!(await exists(target))) return
  if (!(await stat(target)).isDirectory()) throw new Error('Target must be a directory')
  if ((await readdir(target)).length > 0) throw new Error('Target directory must be empty')
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Template symlinks are not allowed')
    if (entry.isDirectory()) await copyDirectory(from, to)
    else if (entry.isFile()) await copyFile(from, to)
  }
}

async function fragmentChecksum(id: string): Promise<string> {
  if (id !== 'base') return sha256(stableJson({ id, version: templateVersion }))
  const entries: string[] = []
  await collectFiles(join(templateRoot, 'base'), '', entries)
  return sha256(entries.sort().join('\n'))
}

async function collectFiles(directory: string, relative: string, output: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const relativePath = join(relative, entry.name)
    if (entry.isDirectory()) await collectFiles(path, relativePath, output)
    else if (entry.isFile()) {
      output.push(`${relativePath}:${sha256(await readFile(path))}`)
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
