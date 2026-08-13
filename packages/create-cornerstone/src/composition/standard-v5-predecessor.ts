import { readFile } from 'node:fs/promises'
import { posix, resolve } from 'node:path'
import { z } from 'zod'
import { sha256, stableJson } from '../hash.js'
import {
  computeScaffoldsDigest,
  validateScaffoldRegistry,
  type ScaffoldRegistryEntry,
} from '../scaffold/registry.js'
import { pascalCase } from '../scaffold/render.js'
import type { ProjectLockV3Data, ProjectManifest, ResolvedManifest } from '../schema.js'
import { composeNestModule, formatJsonDocument } from './composer.js'
import { canonicalTemplateMetadataSchema, type ComposerDefinition } from './template.js'

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
const licenseSchema = z.object({ composer: componentSchema, output: outputSchema }).strict()
const adoptionSourceSchema = z
  .object({ path: safePathSchema, checksum: digestSchema, mode: z.literal(0o644) })
  .strict()
const adoptionTargetSchema = z
  .object({
    action: z.enum(['add', 'modify']),
    path: safePathSchema,
    checksum: digestSchema,
    mode: z.literal(0o644),
  })
  .strict()

const standardV5PredecessorSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2),
    templateVersion: z.literal('0.5.0'),
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
    adoptionTargets: z.array(adoptionTargetSchema),
    scaffoldContract: z
      .object({
        entryVersions: z.tuple([z.literal(1), z.literal(2), z.literal(3)]),
        composedEntries: z.tuple([z.literal('api:3'), z.literal('feature:2')]),
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
    assertSortedUnique(snapshot.adoptionTargets, 'path', 'adoptionTargets', context)
    const owners = new Set(snapshot.composers.map(({ id }) => id))
    for (const output of snapshot.outputs) {
      if (!owners.has(output.owner)) {
        context.addIssue({ code: 'custom', message: `Unknown output owner: ${output.owner}` })
      }
    }
    const sources = new Set(snapshot.adoptionSources.map(({ path }) => path))
    for (const target of snapshot.adoptionTargets) {
      if ((target.action === 'modify') !== sources.has(target.path)) {
        context.addIssue({
          code: 'custom',
          message: `Adoption target/source action mismatch: ${target.path}`,
        })
      }
    }
    for (const source of snapshot.adoptionSources) {
      if (!snapshot.adoptionTargets.some(({ path }) => path === source.path)) {
        context.addIssue({
          code: 'custom',
          message: `Adoption source has no target: ${source.path}`,
        })
      }
    }
  })

export type StandardV5PredecessorSnapshot = z.infer<typeof standardV5PredecessorSnapshotSchema>

export interface ResolvedStandardV5Predecessor {
  snapshot: StandardV5PredecessorSnapshot
  fragments: StandardV5PredecessorSnapshot['fragments']
  composers: StandardV5PredecessorSnapshot['composers']
  outputs: StandardV5PredecessorSnapshot['outputs']
  contents: Map<string, Buffer>
}

const templateRoot = resolve(import.meta.dirname, '..', 'templates', 'canonical')
const version = '0.5.0' as const

export async function loadStandardV5PredecessorSnapshot(): Promise<StandardV5PredecessorSnapshot> {
  return standardV5PredecessorSnapshotSchema.parse(
    JSON.parse(
      await readFile(resolve(templateRoot, 'predecessors', version, 'contract.json'), 'utf8'),
    ),
  )
}

export function parseStandardV5PredecessorSnapshot(value: unknown): StandardV5PredecessorSnapshot {
  return standardV5PredecessorSnapshotSchema.parse(value)
}

export async function resolveStandardV5Predecessor(
  manifest: ResolvedManifest,
  scaffoldsInput: readonly ScaffoldRegistryEntry[],
): Promise<ResolvedStandardV5Predecessor> {
  const scaffolds = validateScaffoldRegistry(scaffoldsInput)
  assertScaffoldContract(scaffolds)
  const snapshot = await loadStandardV5PredecessorSnapshot()
  const metadata = canonicalTemplateMetadataSchema.parse(
    JSON.parse(
      await readFile(resolve(templateRoot, 'predecessors', version, 'standard.json'), 'utf8'),
    ),
  )
  if (metadata.templateVersion !== version) {
    throw new Error('Immutable Standard 0.5.0 metadata version mismatch')
  }
  const contents = new Map<string, Buffer>()
  const outputs: StandardV5PredecessorSnapshot['outputs'] = []
  const composers = [...snapshot.composers]
  for (const declared of snapshot.outputs) {
    const content = await renderOutput(snapshot, metadata, manifest, scaffolds, declared.path)
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
    composers: composers.sort((left, right) => left.id.localeCompare(right.id)),
    outputs: outputs.sort((left, right) => left.path.localeCompare(right.path)),
    contents,
  }
}

export function buildStandardV5PredecessorLock(
  resolved: ResolvedStandardV5Predecessor,
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
  scaffoldsInput: readonly ScaffoldRegistryEntry[],
): ProjectLockV3Data {
  const scaffolds = validateScaffoldRegistry(scaffoldsInput)
  assertScaffoldContract(scaffolds)
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

export async function readStandardV5AdoptionSource(path: string): Promise<Buffer> {
  const snapshot = await loadStandardV5PredecessorSnapshot()
  const source = snapshot.adoptionSources.find((candidate) => candidate.path === path)
  if (!source) throw new Error(`Standard 0.5.0 adoption source is not declared: ${path}`)
  return readSnapshotFile(`adoption-sources/${path}`, source.checksum)
}

export async function readStandardV5AdoptionTarget(path: string): Promise<Buffer> {
  const snapshot = await loadStandardV5PredecessorSnapshot()
  const target = snapshot.adoptionTargets.find((candidate) => candidate.path === path)
  if (!target) throw new Error(`Standard 0.5.0 adoption target is not declared: ${path}`)
  return readSnapshotFile(`adoption-targets/${path}`, target.checksum)
}

function assertScaffoldContract(scaffolds: readonly ScaffoldRegistryEntry[]): void {
  for (const scaffold of scaffolds) {
    if (scaffold.version !== 1 && scaffold.version !== 2 && scaffold.version !== 3) {
      throw new Error('Standard 0.5.0 does not support this scaffold registry entry version')
    }
  }
}

async function renderOutput(
  snapshot: StandardV5PredecessorSnapshot,
  metadata: ReturnType<typeof canonicalTemplateMetadataSchema.parse>,
  manifest: ResolvedManifest,
  scaffolds: readonly ScaffoldRegistryEntry[],
  path: string,
): Promise<Buffer> {
  const declared = snapshot.outputs.find((candidate) => candidate.path === path)
  if (!declared) throw new Error(`Standard 0.5.0 output is not declared: ${path}`)
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
    if (!source.startsWith(heading)) throw new Error('Standard 0.5.0 README fixture is invalid')
    return Buffer.from(`# ${manifest.name}\n${source.slice(heading.length)}`)
  }
  const featureEntries = scaffolds.filter(
    (entry) => entry.kind === 'feature' && entry.version === 2,
  )
  const apiEntries = scaffolds.filter((entry) => entry.kind === 'api' && entry.version === 3)
  if (path === 'apps/api/src/app.module.ts' && (featureEntries.length || apiEntries.length)) {
    const base = nestModule(metadata, 'api-app-module')
    return Buffer.from(
      composeNestModule(
        composeApiDefinition(composeFeatures(base, featureEntries), apiEntries, 'runtime'),
      ),
    )
  }
  if (path === 'apps/api/src/contracts/api-contract.module.ts' && apiEntries.length) {
    return Buffer.from(
      composeNestModule(
        composeApiDefinition(nestModule(metadata, 'api-contract-module'), apiEntries, 'contract'),
      ),
    )
  }
  if (path === 'apps/api/src/authorization/route-policy.ts' && apiEntries.length) {
    return Buffer.from(composeRoutePolicies(original.toString('utf8'), apiEntries))
  }
  return original
}

function nestModule(
  metadata: ReturnType<typeof canonicalTemplateMetadataSchema.parse>,
  id: string,
): NonNullable<ComposerDefinition['nestModule']> {
  const definition = metadata.composers.find((composer) => composer.id === id)
  if (!definition?.nestModule) throw new Error(`Immutable Standard 0.5.0 composer missing: ${id}`)
  return definition.nestModule
}

function composeFeatures(
  base: NonNullable<ComposerDefinition['nestModule']>,
  entries: readonly ScaffoldRegistryEntry[],
): NonNullable<ComposerDefinition['nestModule']> {
  return {
    ...base,
    imports: [
      ...base.imports,
      ...entries.map(({ name }) => ({
        names: [`${pascalCase(name)}Module`],
        from: `./${name}/${name}.module.js`,
      })),
    ].sort((left, right) => compareImports(left.from, right.from)),
    moduleImports: [
      ...base.moduleImports,
      ...entries.map(({ name }) => ({
        kind: 'identifier' as const,
        name: `${pascalCase(name)}Module`,
      })),
    ].sort((left, right) => reference(left).localeCompare(reference(right))),
  }
}

function composeApiDefinition(
  base: NonNullable<ComposerDefinition['nestModule']>,
  entries: readonly ScaffoldRegistryEntry[],
  mode: 'runtime' | 'contract',
): NonNullable<ComposerDefinition['nestModule']> {
  const imports = entries.map(({ name }) =>
    mode === 'runtime'
      ? { names: [`${pascalCase(name)}Module`], from: `./${name}/${name}.module.js` }
      : {
          names: [`${pascalCase(name)}ContractController`],
          from: `./${name}-contract.controller.js`,
        },
  )
  const moduleImports =
    mode === 'runtime'
      ? imports.map(({ names }) => ({ kind: 'identifier' as const, name: names[0]! }))
      : []
  const controllers =
    mode === 'contract' ? entries.map(({ name }) => `${pascalCase(name)}ContractController`) : []
  return {
    ...base,
    imports: [...base.imports, ...imports].sort((left, right) =>
      compareImports(left.from, right.from),
    ),
    moduleImports: [...base.moduleImports, ...moduleImports].sort((left, right) =>
      reference(left).localeCompare(reference(right)),
    ),
    controllers: [...base.controllers, ...controllers].sort(),
  }
}

function composeRoutePolicies(source: string, entries: readonly ScaffoldRegistryEntry[]): string {
  const marker = 'const scaffoldRoutePolicies: readonly RoutePolicy[] = [];'
  if (!source.includes(marker)) {
    throw new Error('Immutable Standard 0.5.0 route policy marker is missing')
  }
  const policies = [...entries]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => {
      if (entry.kind !== 'api' || entry.version !== 3) {
        throw new Error(`Invalid Standard 0.5.0 API contribution: ${entry.id}`)
      }
      const value = entry.options
      return `  { method: '${value.method}', path: '/api/v1${value.path}', operationId: '${value.operationId}', authentication: '${value.authentication}', csrf: ${value.csrf}, roles: [${value.roles.map((role) => `'${role}'`).join(', ')}],${value.permission ? ` permission: '${value.permission}',` : ''} ownership: 'none', owner: 'backend', reason: 'Generated API scaffold ${value.operationId}.' },`
    })
  return source.replace(
    marker,
    `const scaffoldRoutePolicies: readonly RoutePolicy[] = [\n${policies.join('\n')}\n];`,
  )
}

function compareImports(left: string, right: string): number {
  const leftPackage = !left.startsWith('.')
  const rightPackage = !right.startsWith('.')
  if (leftPackage !== rightPackage) return leftPackage ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

function reference(
  value: NonNullable<ComposerDefinition['nestModule']>['moduleImports'][number],
): string {
  return value.kind === 'identifier' ? value.name : value.module
}

async function readSnapshotFile(relativePath: string, checksum: string): Promise<Buffer> {
  const content = await readFile(resolve(templateRoot, 'predecessors', version, relativePath))
  if (sha256(content) !== checksum) {
    throw new Error(`Immutable Standard 0.5.0 snapshot checksum mismatch: ${relativePath}`)
  }
  return content
}

function assertSortedUnique<T extends Record<K, string>, K extends keyof T>(
  values: readonly T[],
  key: K,
  label: string,
  context: z.RefinementCtx,
): void {
  const actual = values.map((value) => value[key])
  const expected = [...new Set(actual)].sort((left, right) => left.localeCompare(right))
  if (stableJson(actual) !== stableJson(expected)) {
    context.addIssue({ code: 'custom', message: `${label} must be sorted and unique` })
  }
}
