import { resolve } from 'node:path'
import { projectLockSchema } from './schema.js'
import {
  adoptStandardV4,
  planStandardV4Adoption,
  type StandardV4AdoptionPlan,
} from './mutation/standard-v4-adoption.js'
import {
  adoptStandardV5,
  planStandardV5Adoption,
  type StandardV5AdoptionPlan,
} from './mutation/standard-v5-adoption.js'
import {
  adoptStandardV6,
  planStandardV6Adoption,
  type StandardV6AdoptionPlan,
} from './mutation/standard-v6-adoption.js'
import { parseMutationJournalV2 } from './mutation/generator-engine.js'
import {
  planProjectUpdate as planLegacyProjectUpdate,
  updateProject as updateLegacyProject,
  type ProjectUpdatePlan as LegacyProjectUpdatePlan,
  assertProjectBoundary,
  lockRelativePath,
  maximumMetadataBytes,
  pathExists,
  readBoundedFile,
  safeTargetPath,
} from './mutation/update-engine.js'

export type ProjectUpdatePlan =
  LegacyProjectUpdatePlan | StandardV4AdoptionPlan | StandardV5AdoptionPlan | StandardV6AdoptionPlan

export async function planProjectUpdate(targetPath: string): Promise<ProjectUpdatePlan> {
  const target = await canonicalTarget(targetPath)
  const lock = await readLock(target)
  if (lock.schemaVersion !== 3) return planLegacyProjectUpdate(target)
  if (lock.templateVersion === '0.3.0') return planStandardV4Adoption(target)
  if (lock.templateVersion === '0.4.0') return planStandardV5Adoption(target)
  return planStandardV6Adoption(target)
}

export async function updateProject(
  targetPath: string,
  options: { dryRun?: boolean } = {},
): Promise<ProjectUpdatePlan> {
  if (options.dryRun) return planProjectUpdate(targetPath)
  const target = await canonicalTarget(targetPath)
  const lock = await readLock(target)
  if (lock.schemaVersion !== 3) return updateLegacyProject(target)
  if (lock.templateVersion === '0.3.0') return adoptStandardV4(target)
  if (lock.templateVersion === '0.4.0') return adoptStandardV5(target)
  return adoptStandardV6(target)
}

async function canonicalTarget(targetPath: string): Promise<string> {
  return assertProjectBoundary(resolve(targetPath))
}

async function readLock(target: string) {
  const journalPath = safeTargetPath(target, '.cornerstone/mutation.journal.json')
  if (await pathExists(journalPath)) {
    const journal = parseMutationJournalV2(
      JSON.parse(
        (
          await readBoundedFile(journalPath, 'Project update journal', maximumMetadataBytes)
        ).toString('utf8'),
      ),
    )
    const lockEntry = journal.entries.find(({ path }) => path === lockRelativePath)
    if (!lockEntry?.backupPath) throw new Error('Project update recovery lock backup is missing')
    return projectLockSchema.parse(
      JSON.parse(
        (
          await readBoundedFile(
            safeTargetPath(target, lockEntry.backupPath),
            'Project update predecessor lock backup',
            maximumMetadataBytes,
          )
        ).toString('utf8'),
      ),
    )
  }
  return projectLockSchema.parse(
    JSON.parse(
      (
        await readBoundedFile(
          safeTargetPath(target, lockRelativePath),
          'Project update lock',
          maximumMetadataBytes,
        )
      ).toString('utf8'),
    ),
  )
}
