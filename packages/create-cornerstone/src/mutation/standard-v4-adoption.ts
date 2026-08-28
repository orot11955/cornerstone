import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { formatJsonDocument } from '../composition/composer.js'
import {
  buildStandardV4PredecessorLock,
  resolveStandardV4Predecessor,
} from '../composition/standard-v4-predecessor.js'
import {
  readStandardV3AdoptionSource,
  resolveStandardV3Predecessor,
} from '../composition/standard-v3-predecessor.js'
import { readManifest, verifyProject } from '../generator.js'
import { sha256 } from '../hash.js'
import { stableJson } from '../hash.js'
import { projectLockV3Schema, resolveManifest } from '../schema.js'
import {
  applyGeneratorMutation,
  parseMutationJournalV2,
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
  pathExists,
  readBoundedFile,
  safeTargetPath,
} from './update-engine.js'

const predecessorTemplateVersion = '0.3.0' as const
const currentTemplateVersion = '0.4.0' as const

export interface StandardV4AdoptionPlan {
  schemaVersion: 1
  target: string
  fromTemplateVersion: typeof predecessorTemplateVersion | typeof currentTemplateVersion
  toTemplateVersion: typeof currentTemplateVersion
  changes: GeneratorMutationPlan['changes']
}

export async function planStandardV4Adoption(targetPath: string): Promise<StandardV4AdoptionPlan> {
  const prepared = await prepareAdoption(targetPath)
  if (!prepared.request) return noOpPlan(prepared.target)
  return toPlan(await planGeneratorMutation(prepared.target, prepared.request))
}

export async function adoptStandardV4(
  targetPath: string,
  options: { dryRun?: boolean } = {},
): Promise<StandardV4AdoptionPlan> {
  if (options.dryRun) return planStandardV4Adoption(targetPath)
  const prepared = await prepareAdoption(targetPath)
  if (!prepared.request) return noOpPlan(prepared.target)
  return toPlan(await applyGeneratorMutation(prepared.target, prepared.request))
}

async function prepareAdoption(
  targetPath: string,
): Promise<{ target: string; request?: GeneratorMutationRequest }> {
  const target = await assertProjectBoundary(resolve(targetPath))
  const lockPath = safeTargetPath(target, lockRelativePath)
  let lockBytes = await readBoundedFile(lockPath, 'Standard v3 adoption lock', maximumMetadataBytes)
  let lock = projectLockV3Schema.parse(JSON.parse(lockBytes.toString('utf8')))
  const journalPath = safeTargetPath(target, '.cornerstone/mutation.journal.json')
  const recovering = await pathExists(journalPath)
  if (recovering) {
    const journal = parseMutationJournalV2(
      JSON.parse(
        (
          await readBoundedFile(journalPath, 'Standard v4 adoption journal', maximumMetadataBytes)
        ).toString('utf8'),
      ),
    )
    const lockEntry = journal.entries.find(({ path }) => path === lockRelativePath)
    if (!lockEntry?.backupPath)
      throw new Error('Standard v4 recovery journal lock backup is missing')
    lockBytes = await readBoundedFile(
      safeTargetPath(target, lockEntry.backupPath),
      'Standard v4 predecessor lock backup',
      maximumMetadataBytes,
    )
    lock = projectLockV3Schema.parse(JSON.parse(lockBytes.toString('utf8')))
  } else if (lock.templateVersion === currentTemplateVersion) {
    await verifyProject(target)
    return { target }
  }
  if (lock.templateVersion !== predecessorTemplateVersion) {
    throw new Error(`Standard v4 adoption requires exact template ${predecessorTemplateVersion}`)
  }
  if (!recovering) {
    try {
      await verifyProject(target)
    } catch (error) {
      throw new Error('Manual migration required: exact Standard 0.3.0 predecessor check failed', {
        cause: error,
      })
    }
  }

  const userManifest = await readManifest(safeTargetPath(target, 'cornerstone.config.yml'))
  const manifest = resolveManifest(userManifest)
  const predecessor = await resolveStandardV3Predecessor(manifest, lock.scaffolds)
  const expectedPredecessorLock = (
    await import('../composition/standard-v3-predecessor.js')
  ).buildStandardV3PredecessorLock(predecessor, userManifest, manifest, lock.scaffolds)
  if (stableJson(lock) !== stableJson(expectedPredecessorLock)) {
    throw new Error('Manual migration required: immutable Standard 0.3.0 lock mismatch')
  }
  for (const source of recovering ? [] : predecessor.snapshot.adoptionSources) {
    const path = safeTargetPath(target, source.path)
    const info = await lstat(path)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !fileModeMatches(info.mode, source.mode) ||
      sha256(await readBoundedFile(path, `Standard 0.3.0 adoption source ${source.path}`)) !==
        source.checksum ||
      sha256(await readStandardV3AdoptionSource(source.path)) !== source.checksum
    ) {
      throw new Error(`Manual migration required: Standard 0.3.0 source changed: ${source.path}`)
    }
  }

  const desired = await resolveStandardV4Predecessor(manifest, lock.scaffolds)
  const desiredLock = buildStandardV4PredecessorLock(
    desired,
    userManifest,
    manifest,
    lock.scaffolds,
  )
  const entries: GeneratorMutationRequest['entries'][number][] = []
  for (const output of desired.outputs) {
    const previous = predecessor.outputs.find(({ path }) => path === output.path)
    const adoptionSource = predecessor.snapshot.adoptionSources.find(
      ({ path }) => path === output.path,
    )
    const before = previous ?? adoptionSource
    if (!before) {
      throw new Error(
        `Manual migration required: Standard 0.4.0 adds unknown output ${output.path}`,
      )
    }
    const content = desired.contents.get(output.path)
    if (!content) throw new Error(`Immutable Standard 0.4.0 output is missing: ${output.path}`)
    if (sha256(content) === before.checksum && previous?.owner === output.owner) continue
    entries.push({
      action: 'modify',
      path: output.path,
      content,
      mode: generatedFileMode,
      beforeChecksum: before.checksum,
      beforeMode: before.mode,
    })
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))
  entries.push({
    action: 'modify',
    path: lockRelativePath,
    content: Buffer.from(formatJsonDocument(desiredLock)),
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

function toPlan(plan: GeneratorMutationPlan): StandardV4AdoptionPlan {
  return {
    schemaVersion: 1,
    target: plan.target,
    fromTemplateVersion: predecessorTemplateVersion,
    toTemplateVersion: currentTemplateVersion,
    changes: plan.changes,
  }
}

function noOpPlan(target: string): StandardV4AdoptionPlan {
  return {
    schemaVersion: 1,
    target,
    fromTemplateVersion: currentTemplateVersion,
    toTemplateVersion: currentTemplateVersion,
    changes: [],
  }
}
