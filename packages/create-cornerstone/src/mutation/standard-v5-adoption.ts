import { lstat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { formatJsonDocument } from '../composition/composer.js'
import {
  buildStandardV4PredecessorLock,
  readStandardV4AdoptionSource,
  readStandardV4AdoptionTarget,
  resolveStandardV4Predecessor,
} from '../composition/standard-v4-predecessor.js'
import { loadCanonicalTemplateMetadata } from '../composition/template.js'
import { buildStandardV3Lock, readManifest, verifyProject } from '../generator.js'
import { sha256, stableJson } from '../hash.js'
import { composeScaffoldAwareOutputs } from '../scaffold/composition.js'
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
  generatedFileMode,
  lockRelativePath,
  maximumMetadataBytes,
  pathExists,
  readBoundedFile,
  safeTargetPath,
} from './update-engine.js'

const predecessorTemplateVersion = '0.4.0' as const
const currentTemplateVersion = '0.5.0' as const

export interface StandardV5AdoptionPlan {
  schemaVersion: 1
  target: string
  fromTemplateVersion: typeof predecessorTemplateVersion | typeof currentTemplateVersion
  toTemplateVersion: typeof currentTemplateVersion
  changes: GeneratorMutationPlan['changes']
}

export async function planStandardV5Adoption(targetPath: string): Promise<StandardV5AdoptionPlan> {
  const prepared = await prepareAdoption(targetPath)
  if (!prepared.request) return noOpPlan(prepared.target)
  return toPlan(await planGeneratorMutation(prepared.target, prepared.request))
}

export async function adoptStandardV5(
  targetPath: string,
  options: { dryRun?: boolean } = {},
): Promise<StandardV5AdoptionPlan> {
  if (options.dryRun) return planStandardV5Adoption(targetPath)
  const prepared = await prepareAdoption(targetPath)
  if (!prepared.request) return noOpPlan(prepared.target)
  return toPlan(await applyGeneratorMutation(prepared.target, prepared.request))
}

async function prepareAdoption(
  targetPath: string,
): Promise<{ target: string; request?: GeneratorMutationRequest }> {
  const target = await assertProjectBoundary(resolve(targetPath))
  const lockPath = safeTargetPath(target, lockRelativePath)
  let lockBytes = await readBoundedFile(lockPath, 'Standard v5 adoption lock', maximumMetadataBytes)
  let lock = projectLockV3Schema.parse(JSON.parse(lockBytes.toString('utf8')))
  const journalPath = safeTargetPath(target, '.cornerstone/mutation.journal.json')
  const recovering = await pathExists(journalPath)
  if (recovering) {
    const journal = parseMutationJournalV2(
      JSON.parse(
        (
          await readBoundedFile(journalPath, 'Standard v5 adoption journal', maximumMetadataBytes)
        ).toString('utf8'),
      ),
    )
    const lockEntry = journal.entries.find(({ path }) => path === lockRelativePath)
    if (!lockEntry?.backupPath) {
      throw new Error('Standard v5 recovery journal lock backup is missing')
    }
    lockBytes = await readBoundedFile(
      safeTargetPath(target, lockEntry.backupPath),
      'Standard v5 predecessor lock backup',
      maximumMetadataBytes,
    )
    lock = projectLockV3Schema.parse(JSON.parse(lockBytes.toString('utf8')))
  } else if (lock.templateVersion === currentTemplateVersion) {
    await verifyProject(target)
    return { target }
  }
  if (lock.templateVersion !== predecessorTemplateVersion) {
    throw new Error(`Standard v5 adoption requires exact template ${predecessorTemplateVersion}`)
  }
  if (!recovering) {
    try {
      await verifyProject(target)
    } catch (error) {
      throw new Error('Manual migration required: exact Standard 0.4.0 predecessor check failed', {
        cause: error,
      })
    }
  }

  const userManifest = await readManifest(safeTargetPath(target, 'cornerstone.config.yml'))
  const manifest = resolveManifest(userManifest)
  const metadata = loadCanonicalTemplateMetadata()
  if (metadata.templateVersion !== currentTemplateVersion) {
    throw new Error(`Standard v5 adoption metadata must be ${currentTemplateVersion}`)
  }
  const predecessor = await resolveStandardV4Predecessor(manifest, lock.scaffolds)
  const expectedPredecessorLock = buildStandardV4PredecessorLock(
    predecessor,
    userManifest,
    manifest,
    lock.scaffolds,
  )
  if (stableJson(lock) !== stableJson(expectedPredecessorLock)) {
    throw new Error('Manual migration required: immutable Standard 0.4.0 lock mismatch')
  }
  if (!recovering) await assertExactPlatformSources(target, predecessor.snapshot)

  const composed = await composeScaffoldAwareOutputs(
    resolve(import.meta.dirname, '..', 'templates', 'canonical'),
    metadata,
    manifest,
    lock.scaffolds,
  )
  const desiredLock = await buildStandardV3Lock(
    target,
    userManifest,
    manifest,
    composed,
    lock.scaffolds,
  )
  const entries: GeneratorMutationRequest['entries'][number][] = []
  for (const output of composed) {
    const previous = predecessor.outputs.find(({ path }) => path === output.path)
    if (!previous) {
      throw new Error(
        `Manual migration required: Standard 0.5.0 adds unknown output ${output.path}`,
      )
    }
    if (sha256(output.content) === previous.checksum && previous.owner === output.owner) continue
    entries.push({
      action: 'modify',
      path: output.path,
      content: output.content,
      mode: generatedFileMode,
      beforeChecksum: previous.checksum,
      beforeMode: previous.mode,
    })
  }
  for (const transition of predecessor.snapshot.adoptionTargets) {
    const content = await readStandardV4AdoptionTarget(transition.path)
    const source = predecessor.snapshot.adoptionSources.find(({ path }) => path === transition.path)
    entries.push(
      transition.action === 'add'
        ? {
            action: 'add',
            path: transition.path,
            content,
            mode: transition.mode,
          }
        : {
            action: 'modify',
            path: transition.path,
            content,
            mode: transition.mode,
            beforeChecksum: source!.checksum,
            beforeMode: source!.mode,
          },
    )
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  entries.push({
    action: 'modify',
    path: lockRelativePath,
    content: Buffer.from(formatJsonDocument(desiredLock)),
    mode: generatedFileMode,
    beforeChecksum: sha256(lockBytes),
    beforeMode: generatedFileMode,
  })
  const createdDirectories = [
    ...new Set(
      predecessor.snapshot.adoptionTargets
        .filter(({ action }) => action === 'add')
        .map(({ path }) => dirname(path))
        .filter((path) => path === 'apps/web/e2e' || path === 'apps/web/src/app/ui-foundation'),
    ),
  ].sort(
    (left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right),
  )
  return {
    target,
    request: {
      operationKind: 'update',
      lockPath: lockRelativePath,
      createdDirectories,
      entries,
    },
  }
}

async function assertExactPlatformSources(
  target: string,
  snapshot: Awaited<ReturnType<typeof resolveStandardV4Predecessor>>['snapshot'],
): Promise<void> {
  for (const source of snapshot.adoptionSources) {
    const path = safeTargetPath(target, source.path)
    let info
    try {
      info = await lstat(path)
    } catch (error) {
      throw new Error(
        `Manual migration required: Standard 0.4.0 source is missing: ${source.path}`,
        {
          cause: error,
        },
      )
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o777) !== source.mode ||
      sha256(await readBoundedFile(path, `Standard 0.4.0 platform source ${source.path}`)) !==
        source.checksum ||
      sha256(await readStandardV4AdoptionSource(source.path)) !== source.checksum
    ) {
      throw new Error(`Manual migration required: Standard 0.4.0 source changed: ${source.path}`)
    }
  }
  for (const addition of snapshot.adoptionTargets.filter(({ action }) => action === 'add')) {
    if (await pathExists(safeTargetPath(target, addition.path))) {
      throw new Error(
        `Manual migration required: Standard 0.5.0 path already exists: ${addition.path}`,
      )
    }
  }
}

function toPlan(plan: GeneratorMutationPlan): StandardV5AdoptionPlan {
  return {
    schemaVersion: 1,
    target: plan.target,
    fromTemplateVersion: predecessorTemplateVersion,
    toTemplateVersion: currentTemplateVersion,
    changes: plan.changes,
  }
}

function noOpPlan(target: string): StandardV5AdoptionPlan {
  return {
    schemaVersion: 1,
    target,
    fromTemplateVersion: currentTemplateVersion,
    toTemplateVersion: currentTemplateVersion,
    changes: [],
  }
}
