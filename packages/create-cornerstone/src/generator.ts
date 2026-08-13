import { randomUUID } from 'node:crypto'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { composeStructuredOutputs, formatJsonDocument } from './composition/composer.js'
import { bundledCapabilityCatalog } from './composition/catalog.js'
import { getCapabilityApplicationOrder } from './composition/resolver.js'
import {
  loadCanonicalTemplateMetadata,
  type CanonicalTemplateMetadata,
  type ComposerDefinition,
} from './composition/template.js'
import { sha256, stableJson } from './hash.js'
import {
  projectLockSchema,
  projectManifestSchema,
  resolveManifest,
  type ProjectLockData,
  type ProjectLockV1Data,
  type ProjectLockV2Data,
  type ProjectManifest,
  type ResolvedManifest,
} from './schema.js'

const generatorVersion = '0.1.0' as const
const legacyTemplateVersion = '0.1.0' as const
const templateRoot = resolve(import.meta.dirname, 'templates', 'canonical')
const generatedFileMode = 0o644
const maximumMetadataBytes = 1024 * 1024

export type ProjectLock = ProjectLockData

export async function readManifest(path: string): Promise<ProjectManifest> {
  const source = await readBoundedFile(path, 'Project manifest')
  const document = parseDocument(source)
  if (document.errors.length > 0) throw document.errors[0]
  return projectManifestSchema.parse(document.toJS({ maxAliasCount: 0 }))
}

export function planProject(manifest: ResolvedManifest) {
  if (isLegacyMinimal(manifest)) {
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

  assertSupportedComposition(manifest)
  const metadata = loadCanonicalTemplateMetadata()
  const selected = new Set(['base', ...manifest.capabilities])
  const files = new Set<string>(['cornerstone.config.yml', '.cornerstone/manifest.lock.json'])
  for (const fragment of metadata.fragments) {
    if (!selected.has(fragment.id)) continue
    for (const path of listPackagedFragmentFiles(fragment.id)) files.add(path)
  }
  for (const composer of applicableComposers(metadata, manifest)) files.add(composer.output)
  return { manifest, files: [...files].sort() }
}

export async function createProject(
  targetPath: string,
  manifestPath: string,
): Promise<ProjectLock> {
  const userManifest = await readManifest(resolve(manifestPath))
  return createProjectFromManifest(targetPath, userManifest)
}

export async function createProjectFromManifest(
  targetPath: string,
  input: unknown,
): Promise<ProjectLock> {
  const target = resolve(targetPath)
  const userManifest = projectManifestSchema.parse(input)
  const manifest = resolveManifest(userManifest)
  assertSupportedComposition(manifest)
  const hadEmptyTarget = await assertTargetAvailable(target)

  const staging = join(dirname(target), `.${basename(target)}.cornerstone-staging-${randomUUID()}`)
  let removedEmptyTarget = false

  try {
    await mkdir(staging, { recursive: false })
    const lock = isLegacyMinimal(manifest)
      ? await writeLegacyProject(staging, userManifest, manifest)
      : await writeStandardProject(staging, userManifest, manifest)
    await verifyProject(staging)

    if (hadEmptyTarget) {
      await rmdir(target)
      removedEmptyTarget = true
    }
    await rename(staging, target)
    return lock
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (removedEmptyTarget) await restoreEmptyTarget(target)
    throw error
  }
}

export async function verifyProject(targetPath: string): Promise<ProjectLock> {
  const target = resolve(targetPath)
  const lockPath = join(target, '.cornerstone', 'manifest.lock.json')
  const lock = projectLockSchema.parse(
    JSON.parse(await readBoundedFile(lockPath, 'Project lock manifest')),
  )
  assertLockIntegrity(lock)

  const userManifest = await readManifest(join(target, 'cornerstone.config.yml'))
  if (sha256(stableJson(userManifest)) !== lock.userManifestDigest) {
    throw new Error('User manifest digest does not match the lock manifest')
  }
  const manifest = resolveManifest(userManifest)
  if (stableJson(manifest) !== stableJson(lock.resolved)) {
    throw new Error('Resolved manifest does not match the lock manifest')
  }

  if (lock.schemaVersion === 1) {
    if (!isLegacyMinimal(manifest)) throw new Error('Lock schemaVersion 1 only supports minimal')
    if (stableJson(lock) !== stableJson(await buildLegacyLock(userManifest, manifest))) {
      throw new Error('Lock manifest differs from the generator-owned resolution')
    }
    for (const required of planProject(manifest).files) await access(join(target, required))
    return lock
  }

  if (lock.schemaVersion === 3) {
    throw new Error('Lock schemaVersion 3 is reader-only and is not yet supported by verification')
  }

  assertSupportedComposition(manifest)
  await verifyStandardProject(target, userManifest, manifest, lock)
  return lock
}

async function writeLegacyProject(
  target: string,
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
): Promise<ProjectLockV1Data> {
  await copyDirectory(join(templateRoot, 'base'), target)
  await mkdir(join(target, '.cornerstone'), { recursive: true })
  await writeFile(
    join(target, 'cornerstone.config.yml'),
    stringify(userManifest, { sortMapEntries: true }),
  )
  await writeFile(
    join(target, 'package.json'),
    `${JSON.stringify(composeLegacyPackageJson(manifest), null, 2)}\n`,
  )
  if (manifest.license && manifest.license !== 'UNLICENSED') {
    await copyFile(join(templateRoot, 'licenses', manifest.license), join(target, 'LICENSE'))
  }
  const lock = await buildLegacyLock(userManifest, manifest)
  await writeLockAtomically(target, lock)
  return lock
}

async function writeStandardProject(
  target: string,
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
): Promise<ProjectLockV2Data> {
  const metadata = loadCanonicalTemplateMetadata()
  const selected = new Set(['base', ...manifest.capabilities])
  for (const id of ['base', ...getCapabilityApplicationOrder(manifest.capabilities)]) {
    if (selected.has(id)) await copyDirectory(join(templateRoot, 'fragments', id), target)
  }

  for (const output of await composeStructuredOutputs(templateRoot, metadata, manifest)) {
    const path = safeTargetPath(target, output.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, output.content, { mode: generatedFileMode })
    await chmod(path, generatedFileMode)
  }

  await mkdir(join(target, '.cornerstone'), { recursive: true })
  await writeFile(
    join(target, 'cornerstone.config.yml'),
    stringify(userManifest, { sortMapEntries: true }),
    { mode: generatedFileMode },
  )
  const lock = await buildStandardLock(target, userManifest, manifest)
  await writeLockAtomically(target, lock)
  return lock
}

async function buildLegacyLock(
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
): Promise<ProjectLockV1Data> {
  const fragments = await Promise.all(
    ['base', ...manifest.capabilities].map(async (id) => ({
      id,
      checksum: await legacyFragmentChecksum(id),
    })),
  )
  const unsigned = {
    schemaVersion: 1 as const,
    generatorVersion,
    templateVersion: legacyTemplateVersion,
    userManifestDigest: sha256(stableJson(userManifest)),
    resolved: manifest,
    compatibility: {
      node: '>=22.20.0 <25' as const,
      pnpm: '11.20.0' as const,
    },
    fragments,
  }
  return { ...unsigned, integrity: sha256(stableJson(unsigned)) }
}

async function buildStandardLock(
  target: string,
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
): Promise<ProjectLockV2Data> {
  const metadata = loadCanonicalTemplateMetadata()
  const fragmentDefinitions = selectedFragmentDefinitions(metadata, manifest)
  const composerDefinitions = applicableComposers(metadata, manifest)
  const fragments = await Promise.all(
    fragmentDefinitions.map(async ({ id, version }) => ({
      id,
      version,
      checksum: await directoryChecksum(join(templateRoot, 'fragments', id)),
    })),
  )
  const composers = await Promise.all(
    composerDefinitions.map(async (composer) => ({
      id: composer.id,
      version: composer.version,
      checksum: await composerChecksum(metadata, composer),
    })),
  )
  const outputs = await Promise.all(
    composerDefinitions.map(async (composer) => {
      const path = safeTargetPath(target, composer.output)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`Generator-owned output must be a regular file: ${composer.output}`)
      }
      return {
        path: composer.output,
        owner: composer.id,
        checksum: sha256(await readFile(path)),
        mode: info.mode & 0o777,
      }
    }),
  )
  const unsigned = {
    schemaVersion: 2 as const,
    generatorVersion,
    templateVersion: metadata.templateVersion,
    userManifestDigest: sha256(stableJson(userManifest)),
    resolved: manifest,
    compatibility: {
      node: '>=22.20.0 <25',
      pnpm: '11.20.0',
      typescript: '5.9.3',
    },
    baselines: {
      manifest: 1 as const,
      database: '1786579300000-GrantAdminBootstrap',
      openapi: '1.0.0',
    },
    fragments: fragments.sort((left, right) => left.id.localeCompare(right.id)),
    composers: composers.sort((left, right) => left.id.localeCompare(right.id)),
    outputs: outputs.sort((left, right) => left.path.localeCompare(right.path)),
    certification: {
      profile: manifest.profile,
      matrix: metadata.profiles.standard.certification.matrix,
      status: metadata.profiles.standard.certification.status,
    },
  }
  return { ...unsigned, integrity: sha256(stableJson(unsigned)) }
}

async function verifyStandardProject(
  target: string,
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
  lock: ProjectLockV2Data,
): Promise<void> {
  const metadata = loadCanonicalTemplateMetadata()
  assertCatalogCompatibility(metadata, manifest)

  const expectedFragments = selectedFragmentDefinitions(metadata, manifest)
  for (const fragment of expectedFragments) {
    const locked = lock.fragments.find(({ id }) => id === fragment.id)
    if (!locked || locked.version !== fragment.version) {
      throw new Error(`Fragment resolution mismatch: ${fragment.id}`)
    }
    if (
      locked.checksum !== (await directoryChecksum(join(templateRoot, 'fragments', fragment.id)))
    ) {
      throw new Error(`Fragment checksum mismatch: ${fragment.id}`)
    }
  }
  if (lock.fragments.length !== expectedFragments.length) {
    throw new Error('Lock contains an unexpected fragment')
  }

  await assertCapabilityResidue(target, metadata, manifest)
  const expectedComposed = await composeStructuredOutputs(templateRoot, metadata, manifest)
  const expectedDefinitions = applicableComposers(metadata, manifest)
  if (
    lock.composers.length !== expectedDefinitions.length ||
    lock.outputs.length !== expectedComposed.length
  ) {
    throw new Error('Lock composer/output set differs from the generator-owned plan')
  }
  for (const definition of expectedDefinitions) {
    const locked = lock.composers.find(({ id }) => id === definition.id)
    if (!locked || locked.version !== definition.version) {
      throw new Error(`Composer resolution mismatch: ${definition.id}`)
    }
    if (locked.checksum !== (await composerChecksum(metadata, definition))) {
      throw new Error(`Composer checksum mismatch: ${definition.id}`)
    }
  }
  for (const expected of expectedComposed) {
    const locked = lock.outputs.find(({ path }) => path === expected.path)
    if (!locked || locked.owner !== expected.owner) {
      throw new Error(`Generator-owned output is missing from lock: ${expected.path}`)
    }
    const path = safeTargetPath(target, expected.path)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Generator-owned output must be a regular file: ${expected.path}`)
    }
    const expectedChecksum = sha256(expected.content)
    if (locked.checksum !== expectedChecksum || sha256(await readFile(path)) !== expectedChecksum) {
      throw new Error(`Generator-owned output drift: ${expected.path}`)
    }
    if (locked.mode !== generatedFileMode || (info.mode & 0o777) !== locked.mode) {
      throw new Error(`Generator-owned output mode drift: ${expected.path}`)
    }
  }

  const expectedLock = await buildStandardLock(target, userManifest, manifest)
  if (stableJson(lock) !== stableJson(expectedLock)) {
    throw new Error('Lock manifest differs from the generator-owned resolution')
  }
}

function assertLockIntegrity(lock: ProjectLock): void {
  const { integrity, ...unsigned } = lock
  if (sha256(stableJson(unsigned)) !== integrity)
    throw new Error('Lock manifest integrity mismatch')
}

function assertSupportedComposition(manifest: ResolvedManifest): void {
  if (isLegacyMinimal(manifest)) return
  const metadata = loadCanonicalTemplateMetadata()
  const exact = [...metadata.profiles.standard.capabilities].sort()
  if (manifest.profile !== 'standard' || stableJson(manifest.capabilities) !== stableJson(exact)) {
    throw new Error(
      'Generator 0.1.0 supports only legacy minimal and the exact standard preview composition; production and regulated remain uncertified',
    )
  }
}

function assertCatalogCompatibility(
  metadata: CanonicalTemplateMetadata,
  manifest: ResolvedManifest,
): void {
  const fragments = new Map(metadata.fragments.map((fragment) => [fragment.id, fragment]))
  for (const capability of manifest.capabilities) {
    const catalog = bundledCapabilityCatalog.find(({ id }) => id === capability)
    const fragment = fragments.get(capability)
    if (
      !catalog ||
      !fragment ||
      catalog.version !== fragment.version ||
      catalog.support !== 'supported'
    ) {
      throw new Error(`Capability catalog is incompatible with fragment ${capability}`)
    }
  }
}

async function assertCapabilityResidue(
  target: string,
  metadata: CanonicalTemplateMetadata,
  manifest: ResolvedManifest,
): Promise<void> {
  const selected = new Set(['base', ...manifest.capabilities])
  for (const fragment of metadata.fragments) {
    for (const path of listPackagedFragmentFiles(fragment.id)) {
      const output = safeTargetPath(target, path)
      if (selected.has(fragment.id)) {
        await access(output)
      } else if (await exists(output)) {
        throw new Error(`Unselected capability residue: ${fragment.id}:${path}`)
      }
    }
  }
}

function selectedFragmentDefinitions(
  metadata: CanonicalTemplateMetadata,
  manifest: ResolvedManifest,
) {
  const selected = new Set(['base', ...manifest.capabilities])
  return metadata.fragments
    .filter(({ id }) => selected.has(id))
    .map(({ id, version }) => ({ id, version }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function applicableComposers(
  metadata: CanonicalTemplateMetadata,
  manifest: ResolvedManifest,
): ComposerDefinition[] {
  return metadata.composers.filter(
    (composer) =>
      composer.format !== 'license' || (!!manifest.license && manifest.license !== 'UNLICENSED'),
  )
}

function listPackagedFragmentFiles(id: string): string[] {
  const root = join(templateRoot, 'fragments', id)
  if (!existsSync(root)) return []
  const files: string[] = []
  collectFilesSync(root, '', files)
  return files.sort()
}

function collectFilesSync(directory: string, relativePath: string, output: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolute = join(directory, entry.name)
    const decodedName = decodePackedSegment(entry.name)
    const path = relativePath ? `${relativePath}/${decodedName}` : decodedName
    if (entry.isDirectory()) collectFilesSync(absolute, path, output)
    else if (entry.isFile()) output.push(path)
    else throw new Error(`Unsupported template entry: ${path}`)
  }
}

function existsSync(path: string): boolean {
  try {
    readdirSync(path)
    return true
  } catch {
    return false
  }
}

async function composerChecksum(
  metadata: CanonicalTemplateMetadata,
  composer: ComposerDefinition,
): Promise<string> {
  const sources: Record<string, string> = {}
  if (composer.source) {
    sources.workspace = sha256(await readFile(join(templateRoot, 'composer-sources', composer.id)))
  }
  if (composer.format === 'license') {
    for (const license of ['ISC', 'MIT']) {
      sources[license] = sha256(await readFile(join(templateRoot, 'licenses', license)))
    }
  }
  if (composer.format === 'notice') {
    sources.generator = sha256(await readFile(join(import.meta.dirname, '..', 'NOTICE')))
    for (const fragment of metadata.fragments) {
      sources[`fragment-${fragment.id}`] = await noticeChecksum(
        join(templateRoot, 'fragments', fragment.id),
      )
    }
  }
  return sha256(stableJson({ definition: composer, sources }))
}

async function noticeChecksum(directory: string): Promise<string> {
  const entries: string[] = []
  await collectFiles(
    directory,
    '',
    entries,
    (name) => name.endsWith('/NOTICE') || name === 'NOTICE',
  )
  return sha256(entries.sort().join('\n'))
}

function composeLegacyPackageJson(manifest: ResolvedManifest) {
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

function isLegacyMinimal(manifest: ResolvedManifest): boolean {
  return manifest.profile === 'minimal' && manifest.capabilities.length === 0
}

async function assertTargetAvailable(target: string): Promise<boolean> {
  if (!(await exists(target))) return false
  if (!(await stat(target)).isDirectory()) throw new Error('Target must be a directory')
  if ((await readdir(target)).length > 0) throw new Error('Target directory must be empty')
  return true
}

async function restoreEmptyTarget(target: string): Promise<void> {
  try {
    await mkdir(target, { recursive: false })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, decodePackedSegment(entry.name))
    if (entry.isSymbolicLink()) throw new Error('Template symlinks are not allowed')
    if (entry.isDirectory()) await copyDirectory(from, to)
    else if (entry.isFile()) await copyFile(from, to)
  }
}

function decodePackedSegment(segment: string): string {
  return segment === '__cornerstone_gitignore__' ? '.gitignore' : segment
}

async function legacyFragmentChecksum(id: string): Promise<string> {
  if (id !== 'base') return sha256(stableJson({ id, version: legacyTemplateVersion }))
  return directoryChecksum(join(templateRoot, 'base'))
}

async function directoryChecksum(directory: string): Promise<string> {
  const entries: string[] = []
  await collectFiles(directory, '', entries)
  return sha256(entries.sort().join('\n'))
}

async function collectFiles(
  directory: string,
  relativePath: string,
  output: string[],
  predicate: (path: string) => boolean = () => true,
): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    const name = relativePath ? `${relativePath}/${entry.name}` : entry.name
    if (entry.isDirectory()) await collectFiles(path, name, output, predicate)
    else if (entry.isFile() && predicate(name))
      output.push(`${name}:${sha256(await readFile(path))}`)
    else if (entry.isSymbolicLink()) throw new Error(`Template symlinks are not allowed: ${name}`)
  }
}

async function writeLockAtomically(target: string, lock: ProjectLock): Promise<void> {
  const temporaryLock = join(target, '.cornerstone', `manifest.lock.${randomUUID()}.tmp`)
  await writeFile(temporaryLock, formatJsonDocument(lock), { mode: generatedFileMode })
  await rename(temporaryLock, join(target, '.cornerstone', 'manifest.lock.json'))
}

function safeTargetPath(target: string, path: string): string {
  const output = resolve(target, path)
  const normalizedRelative = relative(target, output).split(sep).join('/')
  if (!output.startsWith(`${target}${sep}`) || normalizedRelative !== path) {
    throw new Error(`Output path escapes target: ${path}`)
  }
  return output
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readBoundedFile(path: string, label: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maximumMetadataBytes) {
      throw new Error(`${label} exceeds the 1 MiB input limit or is not a regular file`)
    }
    const buffer = Buffer.alloc(maximumMetadataBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > maximumMetadataBytes) {
      throw new Error(`${label} exceeds the 1 MiB input limit or is not a regular file`)
    }
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}
