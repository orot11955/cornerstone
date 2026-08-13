import { readFile } from 'node:fs/promises'
import { posix, resolve } from 'node:path'
import { z } from 'zod'
import { computeScaffoldsDigest, type ScaffoldRegistryEntry } from '../scaffold/registry.js'
import { sha256, stableJson } from '../hash.js'
import type { ProjectLockV3Data, ProjectManifest, ResolvedManifest } from '../schema.js'
import { formatJsonDocument } from './composer.js'
import { canonicalTemplateMetadataSchema } from './template.js'

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const safePathSchema = z
  .string()
  .min(1)
  .refine((path) => path === path.normalize('NFC') && path === posix.normalize(path))
  .refine((path) => !path.startsWith('/') && path !== '..' && !path.startsWith('../'))
const componentSchema = z
  .object({ id: z.string().min(1), version: z.number().int().positive(), checksum: digestSchema })
  .strict()
const outputSchema = z
  .object({
    path: safePathSchema,
    owner: z.string().min(1),
    checksum: digestSchema,
    mode: z.literal(0o644),
  })
  .strict()
const adoptionSourceSchema = z
  .object({ path: safePathSchema, checksum: digestSchema, mode: z.literal(0o644) })
  .strict()
const licenseSchema = z.object({ composer: componentSchema, output: outputSchema }).strict()

const standardV3PredecessorSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2),
    templateVersion: z.literal('0.3.0'),
    fixtureName: z.literal('snapshot-app'),
    generatorVersion: z.literal('0.1.0'),
    compatibility: z
      .object({
        node: z.literal('>=22.20.0 <25'),
        pnpm: z.literal('11.20.0'),
        typescript: z.literal('5.9.3'),
      })
      .strict(),
    baselines: z
      .object({
        manifest: z.literal(1),
        database: z.literal('1786579300000-GrantAdminBootstrap'),
        openapi: z.literal('1.0.0'),
      })
      .strict(),
    certification: z
      .object({
        profile: z.literal('standard'),
        matrix: z.literal('standard-preview-node24-pg17'),
        status: z.literal('supported'),
      })
      .strict(),
    fragments: z.array(componentSchema),
    composers: z.array(componentSchema),
    outputs: z.array(outputSchema),
    adoptionSources: z.array(adoptionSourceSchema),
    scaffoldContract: z
      .object({
        entryVersions: z.tuple([z.literal(1), z.literal(2)]),
        composedEntries: z.tuple([z.literal('feature:2')]),
      })
      .strict(),
    licenses: z.object({ ISC: licenseSchema, MIT: licenseSchema }).strict(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    assertSortedUnique(snapshot.fragments, 'id', 'fragments', context)
    assertSortedUnique(snapshot.composers, 'id', 'composers', context)
    assertSortedUnique(snapshot.outputs, 'path', 'outputs', context)
    assertSortedUnique(snapshot.adoptionSources, 'path', 'adoptionSources', context)
    const owners = new Set(snapshot.composers.map(({ id }) => id))
    for (const output of snapshot.outputs) {
      if (!owners.has(output.owner))
        context.addIssue({ code: 'custom', message: `Unknown output owner: ${output.owner}` })
    }
    const paths = new Set(snapshot.outputs.map(({ path }) => path.toLowerCase()))
    for (const source of snapshot.adoptionSources) {
      if (paths.has(source.path.toLowerCase()))
        context.addIssue({
          code: 'custom',
          message: `Adoption source overlaps output: ${source.path}`,
        })
      paths.add(source.path.toLowerCase())
    }
  })

export type StandardV3PredecessorSnapshot = z.infer<typeof standardV3PredecessorSnapshotSchema>
export interface ResolvedStandardV3Predecessor {
  snapshot: StandardV3PredecessorSnapshot
  fragments: StandardV3PredecessorSnapshot['fragments']
  composers: StandardV3PredecessorSnapshot['composers']
  outputs: StandardV3PredecessorSnapshot['outputs']
  contents: Map<string, Buffer>
}

const templateRoot = resolve(import.meta.dirname, '..', 'templates', 'canonical')
const version = '0.3.0' as const

export async function loadStandardV3PredecessorSnapshot(): Promise<StandardV3PredecessorSnapshot> {
  return standardV3PredecessorSnapshotSchema.parse(
    JSON.parse(
      await readFile(resolve(templateRoot, 'predecessors', version, 'contract.json'), 'utf8'),
    ),
  )
}

export function parseStandardV3PredecessorSnapshot(value: unknown): StandardV3PredecessorSnapshot {
  return standardV3PredecessorSnapshotSchema.parse(value)
}

export async function resolveStandardV3Predecessor(
  manifest: ResolvedManifest,
  scaffolds: readonly ScaffoldRegistryEntry[],
): Promise<ResolvedStandardV3Predecessor> {
  assertLegacyScaffoldContract(scaffolds)
  await initializeSnapshotMetadata()
  const snapshot = await loadStandardV3PredecessorSnapshot()
  const composers = [...snapshot.composers]
  const contents = new Map<string, Buffer>()
  const outputs: StandardV3PredecessorSnapshot['outputs'] = []
  for (const declared of snapshot.outputs) {
    const content = await renderOutput(snapshot, manifest, scaffolds, declared.path)
    contents.set(declared.path, content)
    outputs.push({ ...declared, checksum: sha256(content) })
  }
  if (manifest.license && manifest.license !== 'UNLICENSED') {
    const license = snapshot.licenses[manifest.license]
    const content = await readSnapshotFile(`licenses/${manifest.license}`, license.output.checksum)
    composers.push(license.composer)
    outputs.push(license.output)
    contents.set('LICENSE', content)
  }
  return {
    snapshot,
    fragments: [...snapshot.fragments],
    composers: composers.sort((a, b) => a.id.localeCompare(b.id)),
    outputs: outputs.sort((a, b) => a.path.localeCompare(b.path)),
    contents,
  }
}

export function buildStandardV3PredecessorLock(
  resolved: ResolvedStandardV3Predecessor,
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
  scaffolds: readonly ScaffoldRegistryEntry[],
): ProjectLockV3Data {
  assertLegacyScaffoldContract(scaffolds)
  const snapshot = resolved.snapshot
  const unsigned = {
    schemaVersion: 3 as const,
    generatorVersion: snapshot.generatorVersion,
    templateVersion: snapshot.templateVersion,
    userManifestDigest: sha256(stableJson(userManifest)),
    resolved: manifest,
    compatibility: snapshot.compatibility,
    baselines: snapshot.baselines,
    fragments: resolved.fragments,
    composers: resolved.composers,
    outputs: resolved.outputs,
    certification: snapshot.certification,
    scaffolds: [...scaffolds],
    scaffoldsDigest: computeScaffoldsDigest(scaffolds),
  }
  return { ...unsigned, integrity: sha256(stableJson(unsigned)) }
}

export async function readStandardV3AdoptionSource(path: string): Promise<Buffer> {
  const snapshot = await loadStandardV3PredecessorSnapshot()
  const source = snapshot.adoptionSources.find((candidate) => candidate.path === path)
  if (!source) throw new Error(`Standard 0.3.0 adoption source is not declared: ${path}`)
  return readSnapshotFile(`adoption-sources/${path}`, source.checksum)
}

function assertLegacyScaffoldContract(scaffolds: readonly ScaffoldRegistryEntry[]): void {
  for (const scaffold of scaffolds) {
    if (scaffold.version !== 1 && scaffold.version !== 2) {
      throw new Error(
        `Standard 0.3.0 does not support scaffold registry entry ${scaffold.id} v${scaffold.version}`,
      )
    }
  }
}

async function renderOutput(
  snapshot: StandardV3PredecessorSnapshot,
  manifest: ResolvedManifest,
  scaffolds: readonly ScaffoldRegistryEntry[],
  path: string,
): Promise<Buffer> {
  const declared = snapshot.outputs.find((candidate) => candidate.path === path)
  if (!declared) throw new Error(`Standard 0.3.0 output is not declared: ${path}`)
  const original = await readSnapshotFile(`outputs/${path}`, declared.checksum)
  if (path === 'package.json') {
    const value = JSON.parse(original.toString('utf8')) as Record<string, unknown>
    value.name = manifest.name
    if (manifest.license && manifest.license !== 'UNLICENSED') value.license = manifest.license
    else delete value.license
    return Buffer.from(formatJsonDocument(value))
  }
  if (path === 'README.md') {
    const heading = `# ${snapshot.fixtureName}\n`
    const source = original.toString('utf8')
    if (!source.startsWith(heading)) throw new Error('Standard 0.3.0 README fixture is invalid')
    return Buffer.from(`# ${manifest.name}\n${source.slice(heading.length)}`)
  }
  if (path === 'apps/api/src/app.module.ts') {
    const features = scaffolds
      .filter((entry) => entry.version === 2 && entry.kind === 'feature')
      .map(({ name }) => name)
      .sort()
    if (features.length > 0) return Buffer.from(composeLegacyAppModule(features))
  }
  return original
}

function composeLegacyAppModule(features: readonly string[]): string {
  const metadata = canonicalTemplateMetadataSchema.parse(JSON.parse(requireSnapshotMetadata()))
  const base = metadata.composers.find(({ id }) => id === 'api-app-module')?.nestModule
  if (!base) throw new Error('Standard 0.3.0 AppModule contract is missing')
  const pascal = (name: string) =>
    name
      .split('-')
      .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
      .join('')
  const imports = [
    ...base.imports,
    ...features.map((name) => ({
      names: [`${pascal(name)}Module`],
      from: `./${name}/${name}.module.js`,
    })),
  ].sort((a, b) => compareImports(a.from, b.from))
  const moduleImports = [
    ...base.moduleImports,
    ...features.map((name) => ({ kind: 'identifier' as const, name: `${pascal(name)}Module` })),
  ].sort((a, b) => reference(a).localeCompare(reference(b)))
  return renderLegacyNestModule({ ...base, imports, moduleImports })
}

let snapshotMetadata: string | undefined
function requireSnapshotMetadata(): string {
  if (!snapshotMetadata) {
    throw new Error('Standard 0.3.0 snapshot metadata was not initialized')
  }
  return snapshotMetadata
}

async function initializeSnapshotMetadata(): Promise<void> {
  snapshotMetadata ??= await readFile(
    resolve(templateRoot, 'predecessors', version, 'standard.json'),
    'utf8',
  )
}

function renderLegacyNestModule(
  module: NonNullable<
    ReturnType<typeof canonicalTemplateMetadataSchema.parse>['composers'][number]['nestModule']
  >,
): string {
  const lines = module.imports.map(
    ({ names, from }) => `import { ${names.join(', ')} } from '${from}';`,
  )
  const values = module.moduleImports.map((value) =>
    value.kind === 'identifier'
      ? value.name
      : `${value.module}.forRoot({\n  isGlobal: ${value.isGlobal},\n  cache: ${value.cache},\n  load: [${value.load}],\n  validate: ${value.validate},\n})`,
  )
  const fields: string[] = []
  if (values.length)
    fields.push(
      `  imports: [\n${values
        .map((value) =>
          value
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n'),
        )
        .join(',\n')},\n  ],`,
    )
  if (module.controllers.length) fields.push(`  controllers: [${module.controllers.join(', ')}],`)
  if (module.providers.length)
    fields.push(
      `  providers: [\n${module.providers.map(({ provide, useClass }) => `    { provide: ${provide}, useClass: ${useClass} }`).join(',\n')},\n  ],`,
    )
  return `${lines.join('\n')}\n\n@Module({\n${fields.join('\n')}\n})\nexport class ${module.className} {}\n`
}

function compareImports(left: string, right: string): number {
  const leftPackage = !left.startsWith('.')
  const rightPackage = !right.startsWith('.')
  if (leftPackage !== rightPackage) return leftPackage ? -1 : 1
  return left.localeCompare(right)
}

function reference(value: { kind: string; name?: string; module?: string }): string {
  return value.kind === 'identifier' ? value.name! : value.module!
}

async function readSnapshotFile(relativePath: string, checksum: string): Promise<Buffer> {
  await initializeSnapshotMetadata()
  const content = await readFile(resolve(templateRoot, 'predecessors', version, relativePath))
  if (sha256(content) !== checksum)
    throw new Error(`Immutable Standard 0.3.0 snapshot checksum mismatch: ${relativePath}`)
  return content
}

function assertSortedUnique<T extends Record<K, string>, K extends keyof T>(
  values: readonly T[],
  key: K,
  label: string,
  context: z.RefinementCtx,
): void {
  const actual = values.map((value) => value[key])
  const expected = [...new Set(actual)].sort((a, b) => a.localeCompare(b))
  if (stableJson(actual) !== stableJson(expected))
    context.addIssue({ code: 'custom', message: `${label} must be sorted and unique` })
}
