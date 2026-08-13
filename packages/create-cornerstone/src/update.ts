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
  planProjectUpdate as planLegacyProjectUpdate,
  updateProject as updateLegacyProject,
  type ProjectUpdatePlan as LegacyProjectUpdatePlan,
  assertProjectBoundary,
  lockRelativePath,
  maximumMetadataBytes,
  readBoundedFile,
  safeTargetPath,
} from './mutation/update-engine.js'

export type ProjectUpdatePlan =
  LegacyProjectUpdatePlan | StandardV4AdoptionPlan | StandardV5AdoptionPlan

export async function planProjectUpdate(targetPath: string): Promise<ProjectUpdatePlan> {
  const target = await canonicalTarget(targetPath)
  const lock = await readLock(target)
  if (lock.schemaVersion !== 3) return planLegacyProjectUpdate(target)
  return lock.templateVersion === '0.3.0'
    ? planStandardV4Adoption(target)
    : planStandardV5Adoption(target)
}

export async function updateProject(
  targetPath: string,
  options: { dryRun?: boolean } = {},
): Promise<ProjectUpdatePlan> {
  if (options.dryRun) return planProjectUpdate(targetPath)
  const target = await canonicalTarget(targetPath)
  const lock = await readLock(target)
  if (lock.schemaVersion !== 3) return updateLegacyProject(target)
  return lock.templateVersion === '0.3.0' ? adoptStandardV4(target) : adoptStandardV5(target)
}

async function canonicalTarget(targetPath: string): Promise<string> {
  return assertProjectBoundary(resolve(targetPath))
}

async function readLock(target: string) {
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
