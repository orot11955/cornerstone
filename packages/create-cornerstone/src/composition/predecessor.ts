import { readFile } from 'node:fs/promises'
import { posix, resolve } from 'node:path'
import { z } from 'zod'
import { sha256, stableJson } from '../hash.js'
import type { ProjectLockV2Data, ProjectManifest, ResolvedManifest } from '../schema.js'
import { formatJsonDocument } from './composer.js'

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

const predecessorSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    templateVersion: z.enum(['0.2.0', '0.2.1']),
    fixtureName: z.literal('snapshot-app').default('snapshot-app'),
    fragments: z.array(componentSchema),
    composers: z.array(componentSchema),
    outputs: z.array(outputSchema),
    adoptionSources: z.array(adoptionSourceSchema),
    licenses: z.object({ ISC: licenseSchema, MIT: licenseSchema }).strict().optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    assertSortedUnique(snapshot.fragments, 'id', 'fragments', context)
    assertSortedUnique(snapshot.composers, 'id', 'composers', context)
    assertSortedUnique(snapshot.outputs, 'path', 'outputs', context)
    assertSortedUnique(snapshot.adoptionSources, 'path', 'adoptionSources', context)
    const owners = new Set(snapshot.composers.map(({ id }) => id))
    for (const output of snapshot.outputs) {
      if (!owners.has(output.owner)) {
        context.addIssue({ code: 'custom', message: `Unknown output owner: ${output.owner}` })
      }
    }
    const allocated = new Set(snapshot.outputs.map(({ path }) => path.toLowerCase()))
    for (const source of snapshot.adoptionSources) {
      if (allocated.has(source.path.toLowerCase())) {
        context.addIssue({
          code: 'custom',
          message: `Adoption source overlaps output: ${source.path}`,
        })
      }
      allocated.add(source.path.toLowerCase())
    }
    for (const license of Object.values(snapshot.licenses ?? {})) {
      if (license.composer.id !== 'license' || license.output.owner !== 'license') {
        context.addIssue({ code: 'custom', message: 'Invalid predecessor license ownership' })
      }
      if (license.output.path !== 'LICENSE') {
        context.addIssue({ code: 'custom', message: 'Invalid predecessor license output path' })
      }
    }
  })

export type PredecessorVersion = '0.2.0' | '0.2.1'
export type PredecessorSnapshot = z.infer<typeof predecessorSnapshotSchema>
export interface ResolvedPredecessor {
  snapshot: PredecessorSnapshot
  fragments: PredecessorSnapshot['fragments']
  composers: PredecessorSnapshot['composers']
  outputs: PredecessorSnapshot['outputs']
  contents: Map<string, Buffer>
}

const templateRoot = resolve(import.meta.dirname, '..', 'templates', 'canonical')

export async function loadPredecessorSnapshot(
  version: PredecessorVersion,
): Promise<PredecessorSnapshot> {
  const snapshot = predecessorSnapshotSchema.parse(
    JSON.parse(
      await readFile(resolve(templateRoot, 'predecessors', version, 'contract.json'), 'utf8'),
    ),
  )
  if (snapshot.templateVersion !== version) {
    throw new Error(`Immutable predecessor version mismatch: ${version}`)
  }
  return snapshot
}

export function parsePredecessorSnapshot(value: unknown): PredecessorSnapshot {
  return predecessorSnapshotSchema.parse(value)
}

export async function resolvePredecessor(
  version: PredecessorVersion,
  manifest: ResolvedManifest,
): Promise<ResolvedPredecessor> {
  const snapshot = await loadPredecessorSnapshot(version)
  const composers = [...snapshot.composers]
  const contents = new Map<string, Buffer>()
  const outputs = [] as PredecessorSnapshot['outputs']
  for (const declared of snapshot.outputs) {
    const content = await renderPredecessorOutput(snapshot, manifest, declared.path)
    contents.set(declared.path, content)
    outputs.push({ ...declared, checksum: sha256(content) })
  }
  if (manifest.license && manifest.license !== 'UNLICENSED') {
    const license = snapshot.licenses?.[manifest.license]
    if (!license) throw new Error(`Immutable predecessor license missing: ${manifest.license}`)
    const content = await readSnapshotFile(
      version,
      `licenses/${manifest.license}`,
      license.output.checksum,
    )
    composers.push(license.composer)
    outputs.push(license.output)
    contents.set(license.output.path, content)
  }
  return {
    snapshot,
    fragments: [...snapshot.fragments],
    composers: composers.sort((left, right) => left.id.localeCompare(right.id)),
    outputs: outputs.sort((left, right) => left.path.localeCompare(right.path)),
    contents,
  }
}

export async function readPredecessorAdoptionSource(
  version: PredecessorVersion,
  path: string,
): Promise<Buffer> {
  const snapshot = await loadPredecessorSnapshot(version)
  const source = snapshot.adoptionSources.find((candidate) => candidate.path === path)
  if (!source) throw new Error(`Predecessor ${version} adoption source is not declared: ${path}`)
  return readSnapshotFile(version, `adoption-sources/${path}`, source.checksum)
}

export function buildPredecessorLock(
  resolved: ResolvedPredecessor,
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
): ProjectLockV2Data {
  const unsigned = {
    schemaVersion: 2 as const,
    generatorVersion: '0.1.0',
    templateVersion: resolved.snapshot.templateVersion,
    userManifestDigest: sha256(stableJson(userManifest)),
    resolved: manifest,
    compatibility: { node: '>=22.20.0 <25', pnpm: '11.20.0', typescript: '5.9.3' },
    baselines: {
      manifest: 1 as const,
      database: '1786579300000-GrantAdminBootstrap',
      openapi: '1.0.0',
    },
    fragments: resolved.fragments,
    composers: resolved.composers,
    outputs: resolved.outputs,
    certification: {
      profile: 'standard' as const,
      matrix: 'standard-preview-node24-pg17',
      status: 'supported' as const,
    },
  }
  return { ...unsigned, integrity: sha256(stableJson(unsigned)) }
}

export function predecessorLockBytes(lock: ProjectLockV2Data): Buffer {
  return Buffer.from(formatJsonDocument(lock))
}

async function renderPredecessorOutput(
  snapshot: PredecessorSnapshot,
  manifest: ResolvedManifest,
  path: string,
): Promise<Buffer> {
  const declared = snapshot.outputs.find((candidate) => candidate.path === path)
  if (!declared)
    throw new Error(`Predecessor ${snapshot.templateVersion} output is not declared: ${path}`)
  const original = await readSnapshotFile(
    snapshot.templateVersion,
    `outputs/${path}`,
    declared.checksum,
  )
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
    if (!source.startsWith(heading))
      throw new Error('Immutable predecessor README fixture is invalid')
    return Buffer.from(`# ${manifest.name}\n${source.slice(heading.length)}`)
  }
  return original
}

async function readSnapshotFile(
  version: PredecessorVersion,
  relativePath: string,
  checksum: string,
): Promise<Buffer> {
  const content = await readFile(resolve(templateRoot, 'predecessors', version, relativePath))
  if (sha256(content) !== checksum) {
    throw new Error(`Immutable predecessor ${version} snapshot checksum mismatch: ${relativePath}`)
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
