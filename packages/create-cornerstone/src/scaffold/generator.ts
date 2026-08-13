import { lstat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { composeScaffoldAwareOutputs } from './composition.js'
import { loadCanonicalTemplateMetadata } from '../composition/template.js'
import { formatJsonDocument } from '../composition/composer.js'
import { verifyProject } from '../generator.js'
import { sha256, stableJson } from '../hash.js'
import type { ProjectLockV3Data } from '../schema.js'
import {
  assertApiV3RouteDoesNotCollide,
  computeScaffoldsDigest,
  validateScaffoldRegistry,
  type ScaffoldKind,
} from './registry.js'
import { renderScaffold, type ScaffoldGenerateOptions } from './render.js'
import {
  applyGeneratorMutation,
  planGeneratorMutation,
  type GeneratorMutationPlan,
  type GeneratorMutationRequest,
} from '../mutation/generator-engine.js'
import {
  generatedFileMode,
  lockRelativePath,
  pathExists,
  readBoundedFile,
  safeTargetPath,
} from '../mutation/update-engine.js'

const templateRoot = resolve(import.meta.dirname, '..', 'templates', 'canonical')

export interface ScaffoldPlan {
  schemaVersion: 1
  target: string
  scaffold: ProjectLockV3Data['scaffolds'][number]
  changes: GeneratorMutationPlan['changes']
}

export async function planScaffoldGeneration(
  targetPath: string,
  kind: ScaffoldKind,
  name: string,
  options: ScaffoldGenerateOptions = {},
): Promise<ScaffoldPlan> {
  const prepared = await prepareScaffold(targetPath, kind, name, options)
  return toPlan(prepared.entry, await planGeneratorMutation(prepared.target, prepared.request))
}

export async function generateScaffold(
  targetPath: string,
  kind: ScaffoldKind,
  name: string,
  options: ScaffoldGenerateOptions & { dryRun?: boolean } = {},
): Promise<ScaffoldPlan> {
  const { dryRun = false, ...generateOptions } = options
  if (dryRun) return planScaffoldGeneration(targetPath, kind, name, generateOptions)
  const prepared = await prepareScaffold(targetPath, kind, name, generateOptions)
  return toPlan(prepared.entry, await applyGeneratorMutation(prepared.target, prepared.request))
}

async function prepareScaffold(
  targetPath: string,
  kind: ScaffoldKind,
  name: string,
  options: ScaffoldGenerateOptions,
) {
  const target = resolve(targetPath)
  const current = await verifyProject(target)
  if (current.schemaVersion !== 3 || current.resolved.profile !== 'standard') {
    throw new Error('Scaffold generation requires a verified Standard Lock v3 project')
  }
  const rendered = renderScaffold(kind, name, options)
  if (current.scaffolds.some(({ id }) => id === rendered.entry.id)) {
    throw new Error(`Scaffold already exists: ${rendered.entry.id}`)
  }
  if (rendered.entry.kind === 'api' && rendered.entry.version === 3) {
    assertApiV3RouteDoesNotCollide(current.scaffolds, rendered.entry.options)
  }
  const scaffolds = validateScaffoldRegistry(
    [...current.scaffolds, rendered.entry].sort((left, right) => left.id.localeCompare(right.id)),
    current.outputs.map(({ path }) => path),
  )
  const metadata = loadCanonicalTemplateMetadata()
  const composed = await composeScaffoldAwareOutputs(
    templateRoot,
    metadata,
    current.resolved,
    scaffolds,
  )
  const outputs = composed.map((output) => ({
    path: output.path,
    owner: output.owner,
    checksum: sha256(output.content),
    mode: generatedFileMode,
  }))
  const { integrity: _integrity, ...currentUnsigned } = current
  const unsigned = {
    ...currentUnsigned,
    scaffolds,
    scaffoldsDigest: computeScaffoldsDigest(scaffolds),
    outputs,
  }
  const desiredLock = { ...unsigned, integrity: sha256(stableJson(unsigned)) }
  const lockPath = safeTargetPath(target, lockRelativePath)
  const lockBytes = await readBoundedFile(lockPath, 'Scaffold predecessor lock')
  const lockInfo = await lstat(lockPath)
  const entries: GeneratorMutationRequest['entries'][number][] = []
  for (const [path, content] of rendered.files) {
    entries.push({ action: 'add', path, content, mode: generatedFileMode })
  }
  for (const output of composed) {
    const before = current.outputs.find(({ path }) => path === output.path)
    if (!before) throw new Error(`Current lock is missing composer output: ${output.path}`)
    if (before.checksum === sha256(output.content) && before.mode === generatedFileMode) continue
    entries.push({
      action: 'modify',
      path: output.path,
      content: output.content,
      mode: generatedFileMode,
      beforeChecksum: before.checksum,
      beforeMode: before.mode,
    })
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  entries.push({
    action: 'modify',
    path: lockRelativePath,
    content: Buffer.from(formatJsonDocument(desiredLock)),
    mode: generatedFileMode,
    beforeChecksum: sha256(lockBytes),
    beforeMode: lockInfo.mode & 0o777,
  })
  return {
    target,
    entry: rendered.entry,
    request: {
      operationKind: 'generate' as const,
      lockPath: lockRelativePath,
      createdDirectories: await missingDirectories(target, [...rendered.files.keys()]),
      entries,
    },
  }
}

async function missingDirectories(target: string, paths: readonly string[]): Promise<string[]> {
  const directories = new Set<string>()
  for (const path of paths) {
    let current = dirname(path).split(sep).join('/')
    const missing: string[] = []
    while (current !== '.' && !(await pathExists(safeTargetPath(target, current)))) {
      missing.push(current)
      current = dirname(current).split(sep).join('/')
    }
    for (const directory of missing.reverse()) directories.add(directory)
  }
  return [...directories].sort((left, right) => {
    const depth = left.split('/').length - right.split('/').length
    return depth || left.localeCompare(right)
  })
}

function toPlan(
  scaffold: ProjectLockV3Data['scaffolds'][number],
  plan: GeneratorMutationPlan,
): ScaffoldPlan {
  return { schemaVersion: 1, target: plan.target, scaffold, changes: plan.changes }
}
