import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { formatJsonDocument } from '../composition/composer.js'
import { readPredecessorAdoptionSource, resolvePredecessor } from '../composition/predecessor.js'
import {
  buildStandardV3PredecessorLock,
  resolveStandardV3Predecessor,
} from '../composition/standard-v3-predecessor.js'
import { readManifest, verifyProject } from '../generator.js'
import { sha256 } from '../hash.js'
import { projectLockV2Schema, resolveManifest } from '../schema.js'
import {
  applyGeneratorMutation,
  planGeneratorMutation,
  type GeneratorMutationPlan,
  type GeneratorMutationRequest,
} from './generator-engine.js'
import {
  assertProjectBoundary,
  fileModeMatches,
  generatedFileMode,
  lockRelativePath,
  maximumMetadataBytes,
  readBoundedFile,
  safeTargetPath,
} from './update-engine.js'

const predecessorTemplateVersion = '0.2.1'
const currentTemplateVersion = '0.3.0'
const nestComposerIds = new Set(['api-app-module', 'api-contract-module'])

export interface StandardV3AdoptionPlan {
  schemaVersion: 1
  target: string
  fromTemplateVersion: typeof predecessorTemplateVersion
  toTemplateVersion: typeof currentTemplateVersion
  changes: GeneratorMutationPlan['changes']
}

export async function planStandardV3Adoption(targetPath: string): Promise<StandardV3AdoptionPlan> {
  const { target, request } = await prepareAdoption(targetPath)
  return toAdoptionPlan(await planGeneratorMutation(target, request))
}

export async function adoptStandardV3(
  targetPath: string,
  options: { dryRun?: boolean } = {},
): Promise<StandardV3AdoptionPlan> {
  if (options.dryRun) return planStandardV3Adoption(targetPath)
  const { target, request } = await prepareAdoption(targetPath)
  return toAdoptionPlan(await applyGeneratorMutation(target, request))
}

async function prepareAdoption(
  targetPath: string,
): Promise<{ target: string; request: GeneratorMutationRequest }> {
  const target = await assertProjectBoundary(resolve(targetPath))
  const lockPath = safeTargetPath(target, lockRelativePath)
  const lockBytes = await readBoundedFile(
    lockPath,
    'Standard v2 adoption lock',
    maximumMetadataBytes,
  )
  const lock = projectLockV2Schema.parse(JSON.parse(lockBytes.toString('utf8')))
  if (lock.templateVersion !== predecessorTemplateVersion) {
    throw new Error(`Standard v3 adoption requires exact template ${predecessorTemplateVersion}`)
  }
  try {
    await verifyProject(target)
  } catch (error) {
    throw new Error(`Manual migration required: exact Standard v2 predecessor check failed`, {
      cause: error,
    })
  }
  const userManifest = await readManifest(safeTargetPath(target, 'cornerstone.config.yml'))
  const manifest = resolveManifest(userManifest)
  const predecessor = await resolvePredecessor(predecessorTemplateVersion, manifest)
  for (const source of predecessor.snapshot.adoptionSources) {
    const path = safeTargetPath(target, source.path)
    const info = await lstat(path)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !fileModeMatches(info.mode, source.mode) ||
      sha256(await readBoundedFile(path, `Nest module predecessor ${source.path}`)) !==
        source.checksum ||
      sha256(await readPredecessorAdoptionSource(predecessorTemplateVersion, source.path)) !==
        source.checksum
    ) {
      throw new Error(`Manual migration required: Nest module predecessor changed: ${source.path}`)
    }
  }
  const desired = await resolveStandardV3Predecessor(manifest, [])
  const desiredLock = buildStandardV3PredecessorLock(desired, userManifest, manifest, [])
  const desiredBytes = Buffer.from(formatJsonDocument(desiredLock))
  const entries: GeneratorMutationRequest['entries'][number][] = []
  for (const output of desired.outputs) {
    const previousOutput = predecessor.outputs.find(({ path }) => path === output.path)
    const adoptionSource = predecessor.snapshot.adoptionSources.find(
      ({ path }) => path === output.path,
    )
    const before = previousOutput ?? adoptionSource
    if (!before) {
      throw new Error(
        `Manual migration required: current composer adds unknown output ${output.path}`,
      )
    }
    const content = desired.contents.get(output.path)
    if (!content) throw new Error(`Immutable Standard 0.3.0 output is missing: ${output.path}`)
    const afterChecksum = sha256(content)
    if (afterChecksum === before.checksum && !nestComposerIds.has(output.owner)) continue
    entries.push({
      action: 'modify',
      path: output.path,
      content,
      mode: generatedFileMode,
      beforeChecksum: before.checksum,
      beforeMode: before.mode,
    })
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  entries.push({
    action: 'modify',
    path: lockRelativePath,
    content: desiredBytes,
    mode: generatedFileMode,
    beforeChecksum: sha256(lockBytes),
    beforeMode: generatedFileMode,
  })
  return {
    target,
    request: {
      operationKind: 'update',
      lockPath: lockRelativePath,
      createdDirectories: [],
      entries,
    },
  }
}

function toAdoptionPlan(plan: GeneratorMutationPlan): StandardV3AdoptionPlan {
  return {
    schemaVersion: 1,
    target: plan.target,
    fromTemplateVersion: predecessorTemplateVersion,
    toTemplateVersion: currentTemplateVersion,
    changes: plan.changes,
  }
}
