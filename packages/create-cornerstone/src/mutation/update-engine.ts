import { randomUUID } from 'node:crypto'
import {
  access,
  lstat,
  mkdir,
  open,
  realpath,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parseDocument } from 'yaml'
import {
  composePredecessorReadme,
  composeStructuredOutputs,
  formatJsonDocument,
} from '../composition/composer.js'
import {
  loadCanonicalTemplateMetadata,
  type CanonicalTemplateMetadata,
  type ComposerDefinition,
} from '../composition/template.js'
import { sha256, stableJson } from '../hash.js'
import {
  projectLockV2Schema,
  projectManifestSchema,
  resolveManifest,
  type ProjectLockV2Data,
  type ProjectManifest,
  type ResolvedManifest,
} from '../schema.js'
import {
  failUpdateIfInjected,
  isTrustedUpdateParentPolicy,
  runUpdateHookForTest,
} from './test-controls.js'

const predecessorTemplateVersion = '0.2.0'
const currentTemplateVersion = '0.2.1'
const journalRelativePath = '.cornerstone/update.journal.json'
export const lockRelativePath = '.cornerstone/manifest.lock.json'
export const maximumMetadataBytes = 1024 * 1024
const maximumGeneratedFileBytes = 16 * 1024 * 1024
export const generatedFileMode = 0o644
const templateRoot = resolve(import.meta.dirname, '..', 'templates', 'canonical')
const updateLockRelativePath = '.cornerstone/update.lock'
const approvedGeneratorVersion = '0.1.0'
const approvedCompatibility = {
  node: '>=22.20.0 <25',
  pnpm: '11.20.0',
  typescript: '5.9.3',
} as const
const approvedBaselines = {
  manifest: 1 as const,
  database: '1786579300000-GrantAdminBootstrap',
  openapi: '1.0.0',
}
const approvedCertification = {
  profile: 'standard' as const,
  matrix: 'standard-preview-node24-pg17',
  status: 'supported' as const,
}
const digestPattern = /^sha256:[a-f0-9]{64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface UpdateChange {
  action: 'modify'
  afterChecksum: string
  beforeChecksum: string
  beforeMode: number
  diff: string | null
  mode: number
  owner: string
  path: string
}

export interface ProjectUpdatePlan {
  schemaVersion: 1
  target: string
  fromTemplateVersion: string
  toTemplateVersion: string
  changes: UpdateChange[]
}

interface JournalEntry {
  path: string
  backupPath: string
  beforeChecksum: string
  afterChecksum: string
  beforeMode: number
  afterMode: number
}

interface ExpectedFileState {
  checksum: string
  mode: number
}

interface UpdateJournal {
  schemaVersion: 1
  operationId: string
  backupRoot: string
  status: 'preparing' | 'pending' | 'rolled-back' | 'committed'
  entries: JournalEntry[]
}

interface PreparedUpdate {
  plan: ProjectUpdatePlan
  contents: Map<string, Uint8Array>
}

export async function planProjectUpdate(targetPath: string): Promise<ProjectUpdatePlan> {
  const target = await assertProjectBoundary(resolve(targetPath))
  await assertNoPendingJournal(target)
  return (await prepareUpdate(target)).plan
}

export async function updateProject(
  targetPath: string,
  options: { dryRun?: boolean } = {},
): Promise<ProjectUpdatePlan> {
  const lexicalTarget = resolve(targetPath)
  if (options.dryRun) return planProjectUpdate(lexicalTarget)
  const target = await assertProjectBoundary(lexicalTarget)
  await assertUpdateOwnershipBoundary(target)
  return withUpdateOperationLock(target, async () => {
    await recoverProjectUpdate(target)
    const prepared = await prepareUpdate(target)
    await applyUpdate(target, prepared)
    return prepared.plan
  })
}

export async function withUpdateOperationLock<T>(
  target: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = safeTargetPath(target, updateLockRelativePath)
  const nonce = randomUUID()
  await assertOwnedWriteAncestors(target, updateLockRelativePath)
  try {
    await mkdir(lockPath, { recursive: false, mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        'Another update operation or stale update lock exists; inspect .cornerstone/update.lock and remove it only after confirming no update process is running',
      )
    }
    throw error
  }
  const lockInfo = await lstat(lockPath)
  if (!lockInfo.isDirectory() || lockInfo.isSymbolicLink()) {
    throw new Error('Created update operation lock is not a real directory')
  }
  let ownerBytes: Buffer | undefined
  try {
    ownerBytes = Buffer.from(
      formatJsonDocument({
        schemaVersion: 1,
        nonce,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        directoryIdentity: { device: lockInfo.dev, inode: lockInfo.ino },
      }),
    )
    if (ownerBytes.byteLength > maximumMetadataBytes)
      throw new Error('Update lock owner metadata is too large')
    await assertOwnedDirectory(lockPath, updateLockRelativePath)
    await writeFile(join(lockPath, 'owner.json'), ownerBytes, { flag: 'wx', mode: 0o600 })
    return await operation()
  } finally {
    if (!ownerBytes) throw new Error('Update operation lock owner metadata was not created')
    await runUpdateHookForTest('before-operation-lock-cleanup')
    failUpdateIfInjected('before-operation-lock-cleanup')
    await assertOwnedUpdateLock(target, lockInfo.dev, lockInfo.ino, sha256(ownerBytes))
    await assertOwnedWriteAncestors(target, updateLockRelativePath)
    await rm(lockPath, { recursive: true })
  }
}

async function assertOwnedUpdateLock(
  target: string,
  device: number,
  inode: number,
  ownerChecksum: string,
): Promise<void> {
  await assertExactDirectoryWithinTarget(target, updateLockRelativePath)
  const lockPath = safeTargetPath(target, updateLockRelativePath)
  const info = await lstat(lockPath)
  if (info.dev !== device || info.ino !== inode) {
    throw new Error('Update operation lock ownership changed; replacement lock was preserved')
  }
  const ownerPath = join(lockPath, 'owner.json')
  const ownerInfo = await lstat(ownerPath)
  if (
    !ownerInfo.isFile() ||
    ownerInfo.isSymbolicLink() ||
    (ownerInfo.mode & 0o777) !== 0o600 ||
    sha256(await readBoundedFile(ownerPath, 'Update lock owner metadata')) !== ownerChecksum
  ) {
    throw new Error('Update operation lock owner metadata changed; lock was preserved')
  }
}

async function prepareUpdate(target: string): Promise<PreparedUpdate> {
  await assertSafeRegularFile(target, lockRelativePath)
  const projectLockInfo = await lstat(safeTargetPath(target, lockRelativePath))
  if ((projectLockInfo.mode & 0o777) !== generatedFileMode) {
    throw new Error('Generator-owned lock manifest mode was modified')
  }
  const lockBytes = await readBoundedFile(
    safeTargetPath(target, lockRelativePath),
    'Project lock manifest',
  )
  const lock = projectLockV2Schema.parse(JSON.parse(lockBytes.toString('utf8')))
  assertIntegrity(lock)
  await assertSafeRegularFile(target, 'cornerstone.config.yml')
  const userManifest = await readManifest(safeTargetPath(target, 'cornerstone.config.yml'))
  if (sha256(stableJson(userManifest)) !== lock.userManifestDigest) {
    throw new Error('User manifest digest does not match the update lock')
  }
  const manifest = resolveManifest(userManifest)
  assertExactStandard(manifest)
  if (stableJson(manifest) !== stableJson(lock.resolved)) {
    throw new Error('Resolved manifest does not match the update lock')
  }

  const metadata = loadCanonicalTemplateMetadata()
  if (metadata.templateVersion !== currentTemplateVersion) {
    throw new Error(`Generator update metadata must be ${currentTemplateVersion}`)
  }
  assertApprovedLockFields(lock)
  const fragments = metadata.fragments.filter(
    ({ id }) => id === 'base' || manifest.capabilities.includes(id as never),
  )
  await assertFragmentsUnchanged(lock, fragments)
  if (lock.templateVersion === predecessorTemplateVersion) {
    await assertPredecessorComposers(lock, metadata, manifest)
  } else if (lock.templateVersion === currentTemplateVersion) {
    await assertCurrentComposers(lock, metadata, manifest)
  } else {
    throw new Error(
      `Update requires Standard template ${predecessorTemplateVersion} or ${currentTemplateVersion}`,
    )
  }
  assertExactOutputSet(lock, applicableComposers(metadata.composers, manifest))
  await assertLockedOutputs(target, lock)

  const composed = await composeStructuredOutputs(templateRoot, metadata, manifest)
  for (const output of composed) assertGeneratedSize(output.content, output.path)
  const desiredLock = await buildDesiredLock(userManifest, manifest, metadata, composed)
  if (lock.templateVersion === currentTemplateVersion) {
    if (stableJson(lock) !== stableJson(desiredLock)) {
      throw new Error('Current Standard lock differs from the generator-owned resolution')
    }
    return {
      plan: {
        schemaVersion: 1,
        target,
        fromTemplateVersion: currentTemplateVersion,
        toTemplateVersion: currentTemplateVersion,
        changes: [],
      },
      contents: new Map(),
    }
  }

  const contents = new Map<string, Uint8Array>()
  const changes: UpdateChange[] = []
  for (const output of composed) {
    const locked = lock.outputs.find(({ path }) => path === output.path)
    if (!locked) throw new Error(`Manual migration required for new output ${output.path}`)
    const afterChecksum = sha256(output.content)
    if (afterChecksum === locked.checksum && locked.mode === generatedFileMode) continue
    contents.set(output.path, output.content)
    changes.push({
      action: 'modify',
      path: output.path,
      owner: output.owner,
      beforeChecksum: locked.checksum,
      beforeMode: locked.mode,
      afterChecksum,
      mode: generatedFileMode,
      diff:
        output.path === 'README.md'
          ? lineDiff(
              (
                await readGeneratedFile(
                  safeTargetPath(target, output.path),
                  `Generator-owned output ${output.path}`,
                )
              ).toString('utf8'),
              Buffer.from(output.content).toString('utf8'),
            )
          : null,
    })
  }

  const desiredLockBytes = Buffer.from(formatJsonDocument(desiredLock))
  contents.set(lockRelativePath, desiredLockBytes)
  changes.push({
    action: 'modify',
    path: lockRelativePath,
    owner: 'manifest-lock',
    beforeChecksum: sha256(lockBytes),
    beforeMode: projectLockInfo.mode & 0o777,
    afterChecksum: sha256(desiredLockBytes),
    mode: generatedFileMode,
    diff: null,
  })
  changes.sort((left, right) => left.path.localeCompare(right.path))
  return {
    plan: {
      schemaVersion: 1,
      target,
      fromTemplateVersion: predecessorTemplateVersion,
      toTemplateVersion: currentTemplateVersion,
      changes,
    },
    contents,
  }
}

async function applyUpdate(target: string, prepared: PreparedUpdate): Promise<void> {
  if (prepared.plan.changes.length === 0) return
  const operationId = randomUUID()
  const backupRoot = `.cornerstone/update-backup-${operationId}`
  await assertDirectory(safeTargetPath(target, '.cornerstone'), '.cornerstone')
  const journal: UpdateJournal = {
    schemaVersion: 1,
    operationId,
    backupRoot,
    status: 'preparing',
    entries: [],
  }
  await writeJournal(target, journal)
  let backupRootCreated = false
  try {
    await assertOwnedWriteAncestors(target, backupRoot)
    await mkdir(safeTargetPath(target, backupRoot), { recursive: false, mode: 0o700 })
    backupRootCreated = true
    await runUpdateHookForTest('before-backup')
    failUpdateIfInjected('before-backup')
    for (const change of prepared.plan.changes) {
      await assertChangeState(target, change)
      const backupPath = `${backupRoot}/${change.path}`
      const backup = safeTargetPath(target, backupPath)
      await ensureBackupParents(target, backupRoot, change.path)
      await assertSafeAncestors(target, backupPath)
      const source = await readGeneratedFile(
        safeTargetPath(target, change.path),
        `Update source ${change.path}`,
      )
      if (sha256(source) !== change.beforeChecksum) {
        throw new Error(`Update source changed while backing up: ${change.path}`)
      }
      await assertOwnedWriteAncestors(target, backupPath)
      await writeNewDurableFile(backup, source, change.beforeMode)
      await syncDirectory(dirname(backup))
      await assertChangeState(target, change)
      journal.entries.push({
        path: change.path,
        backupPath,
        beforeChecksum: change.beforeChecksum,
        afterChecksum: change.afterChecksum,
        beforeMode: change.beforeMode,
        afterMode: change.mode,
      })
      await writeJournal(target, journal)
    }
    await syncBackupDirectories(target, backupRoot, journal.entries)
    journal.status = 'pending'
    await writeJournal(target, journal)
  } catch (error) {
    if (backupRootCreated) {
      await removeValidatedDirectory(target, backupRoot)
    }
    await assertOwnedWriteAncestors(target, journalRelativePath)
    await rm(safeTargetPath(target, journalRelativePath), { force: true })
    throw error
  }

  try {
    for (const change of prepared.plan.changes.filter(({ path }) => path !== lockRelativePath)) {
      await assertChangeState(target, change)
      await replaceFile(target, change.path, requiredContent(prepared, change.path), change.mode, [
        { checksum: change.beforeChecksum, mode: change.beforeMode },
      ])
    }
    await runUpdateHookForTest('after-output')
    failUpdateIfInjected('after-output')
    const lockChange = prepared.plan.changes.find(({ path }) => path === lockRelativePath)
    if (!lockChange) throw new Error('Update plan is missing the lock change')
    await assertChangeState(target, lockChange)
    await replaceFile(
      target,
      lockRelativePath,
      requiredContent(prepared, lockRelativePath),
      lockChange.mode,
      [{ checksum: lockChange.beforeChecksum, mode: lockChange.beforeMode }],
    )
    journal.status = 'committed'
    await writeJournal(target, journal)
  } catch (error) {
    await rollbackJournal(target, journal)
    throw error
  }
  await runUpdateHookForTest('after-commit-before-cleanup')
  failUpdateIfInjected('after-commit-before-cleanup')
  await cleanupJournal(target, journal)
}

export async function ensureBackupParents(
  target: string,
  backupRoot: string,
  outputPath: string,
): Promise<void> {
  let current = backupRoot
  for (const segment of outputPath.split('/').slice(0, -1)) {
    await assertOwnedWriteAncestors(target, `${current}/sentinel`)
    current = `${current}/${segment}`
    try {
      await mkdir(safeTargetPath(target, current), { recursive: false, mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await assertExactDirectoryWithinTarget(target, current)
    await assertOwnedDirectory(safeTargetPath(target, current), current)
  }
}

export async function syncBackupDirectories(
  target: string,
  backupRoot: string,
  entries: readonly JournalEntry[],
): Promise<void> {
  const directories = new Set([backupRoot])
  for (const entry of entries) {
    let current = dirname(entry.backupPath).split(sep).join('/')
    while (current === backupRoot || current.startsWith(`${backupRoot}/`)) {
      directories.add(current)
      if (current === backupRoot) break
      current = dirname(current).split(sep).join('/')
    }
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    await assertOwnedDirectory(safeTargetPath(target, directory), directory)
    await syncDirectory(safeTargetPath(target, directory))
  }
}

function requiredContent(prepared: PreparedUpdate, path: string): Uint8Array {
  const content = prepared.contents.get(path)
  if (!content) throw new Error(`Update plan content is missing: ${path}`)
  assertGeneratedSize(content, path)
  return content
}

async function assertChangeState(target: string, change: UpdateChange): Promise<void> {
  await assertSafeAncestors(target, change.path)
  const path = safeTargetPath(target, change.path)
  const info = await lstat(path)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    sha256(await readGeneratedFile(path, `Update source ${change.path}`)) !==
      change.beforeChecksum ||
    (info.mode & 0o777) !== change.beforeMode
  ) {
    throw new Error(`Update source changed after planning: ${change.path}`)
  }
}

async function recoverProjectUpdate(target: string): Promise<void> {
  const journalPath = safeTargetPath(target, journalRelativePath)
  try {
    await access(journalPath)
  } catch {
    return
  }
  await assertSafeRegularFile(target, journalRelativePath)
  const journal = parseJournal(
    JSON.parse((await readBoundedFile(journalPath, 'Update journal')).toString('utf8')),
  )
  if (journal.status === 'preparing') {
    await cleanupPreparingJournal(target, journal)
  } else if (journal.status === 'committed') {
    const hasBackup = await pathExists(safeTargetPath(target, journal.backupRoot))
    if (hasBackup) {
      await validateRecoveryJournal(target, journal)
    }
    const current = await prepareUpdate(target)
    if (current.plan.changes.length !== 0) {
      throw new Error('Committed update journal does not match the current generator state')
    }
    if (!hasBackup) await validateCommittedJournalWithoutBackup(target, journal)
    await assertJournalTargetStates(target, journal, 'after')
    await cleanupJournal(target, journal)
  } else if (journal.status === 'rolled-back') {
    const hasBackup = await pathExists(safeTargetPath(target, journal.backupRoot))
    if (hasBackup) await validateRecoveryJournal(target, journal)
    else await validateRolledBackJournalWithoutBackup(target, journal)
    await assertJournalTargetStates(target, journal, 'before')
    await cleanupJournal(target, journal)
  } else {
    await validateRecoveryJournal(target, journal)
    await rollbackJournal(target, journal)
  }
}

async function validateRolledBackJournalWithoutBackup(
  target: string,
  journal: UpdateJournal,
): Promise<void> {
  const prepared = await prepareUpdate(target)
  if (
    prepared.plan.fromTemplateVersion !== predecessorTemplateVersion ||
    prepared.plan.toTemplateVersion !== currentTemplateVersion ||
    prepared.plan.changes.length === 0
  ) {
    throw new Error('Rolled-back update journal does not match the predecessor project state')
  }
  const expected = prepared.plan.changes.map((change): JournalEntry => ({
    path: change.path,
    backupPath: `${journal.backupRoot}/${change.path}`,
    beforeChecksum: change.beforeChecksum,
    afterChecksum: change.afterChecksum,
    beforeMode: change.beforeMode,
    afterMode: change.mode,
  }))
  const sortEntries = (entries: readonly JournalEntry[]) =>
    [...entries].sort((left, right) => left.path.localeCompare(right.path))
  if (stableJson(sortEntries(journal.entries)) !== stableJson(sortEntries(expected))) {
    throw new Error('Rolled-back update journal does not match the exact lifecycle transition')
  }
}

async function validateCommittedJournalWithoutBackup(
  target: string,
  journal: UpdateJournal,
): Promise<void> {
  const currentLockBytes = await readBoundedFile(
    safeTargetPath(target, lockRelativePath),
    'Current project lock',
  )
  const currentLock = projectLockV2Schema.parse(JSON.parse(currentLockBytes.toString('utf8')))
  assertIntegrity(currentLock)
  const manifest = currentLock.resolved
  const metadata = loadCanonicalTemplateMetadata()
  const readmeDefinition = metadata.composers.find(({ id }) => id === 'project-readme')
  if (!readmeDefinition) throw new Error('Current metadata is missing project-readme')
  const predecessorReadme = composePredecessorReadme(manifest, currentLock.certification.matrix)
  const predecessorComposers = await Promise.all(
    currentLock.composers.map(async (composer) =>
      composer.id === 'project-readme'
        ? {
            id: composer.id,
            version: 1,
            checksum: await composerChecksum({ ...readmeDefinition, version: 1 }, metadata),
          }
        : composer,
    ),
  )
  const { integrity: _integrity, ...currentUnsigned } = currentLock
  const predecessorUnsigned = {
    ...currentUnsigned,
    templateVersion: predecessorTemplateVersion,
    composers: predecessorComposers,
    outputs: currentLock.outputs.map((output) =>
      output.owner === 'project-readme'
        ? { ...output, checksum: sha256(predecessorReadme) }
        : output,
    ),
  }
  const predecessorLock = {
    ...predecessorUnsigned,
    integrity: sha256(stableJson(predecessorUnsigned)),
  }
  const readmeOutput = currentLock.outputs.find(({ owner }) => owner === 'project-readme')
  if (!readmeOutput) throw new Error('Current lock is missing project-readme output')
  const expected: JournalEntry[] = [
    {
      path: lockRelativePath,
      backupPath: `${journal.backupRoot}/${lockRelativePath}`,
      beforeChecksum: sha256(Buffer.from(formatJsonDocument(predecessorLock))),
      afterChecksum: sha256(currentLockBytes),
      beforeMode: generatedFileMode,
      afterMode: generatedFileMode,
    },
    {
      path: 'README.md',
      backupPath: `${journal.backupRoot}/README.md`,
      beforeChecksum: sha256(predecessorReadme),
      afterChecksum: readmeOutput.checksum,
      beforeMode: generatedFileMode,
      afterMode: generatedFileMode,
    },
  ]
  const sortEntries = (entries: readonly JournalEntry[]) =>
    [...entries].sort((left, right) => left.path.localeCompare(right.path))
  if (stableJson(sortEntries(journal.entries)) !== stableJson(sortEntries(expected))) {
    throw new Error('Committed update journal does not match the exact lifecycle transition')
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function validateRecoveryJournal(target: string, journal: UpdateJournal): Promise<void> {
  const lockEntry = journal.entries.find(({ path }) => path === lockRelativePath)
  if (!lockEntry) throw new Error('Invalid update journal: lock entry missing')
  await assertSafeAncestors(target, lockEntry.backupPath)
  const backupPath = safeTargetPath(target, lockEntry.backupPath)
  await assertExpectedFileState(backupPath, lockEntry.backupPath, [
    { checksum: lockEntry.beforeChecksum, mode: lockEntry.beforeMode },
  ])
  const lockBytes = await readBoundedFile(backupPath, 'Update predecessor lock backup')
  const lock = projectLockV2Schema.parse(JSON.parse(lockBytes.toString('utf8')))
  assertIntegrity(lock)
  if (lock.templateVersion !== predecessorTemplateVersion) {
    throw new Error('Update recovery requires the exact predecessor lock')
  }
  if (
    sha256(lockBytes) !== lockEntry.beforeChecksum ||
    lockEntry.beforeMode !== generatedFileMode
  ) {
    throw new Error('Update recovery predecessor lock state is inconsistent')
  }
  await assertSafeRegularFile(target, 'cornerstone.config.yml')
  const userManifest = await readManifest(safeTargetPath(target, 'cornerstone.config.yml'))
  if (sha256(stableJson(userManifest)) !== lock.userManifestDigest) {
    throw new Error('Update recovery manifest digest does not match the predecessor lock')
  }
  const manifest = resolveManifest(userManifest)
  assertExactStandard(manifest)
  if (stableJson(manifest) !== stableJson(lock.resolved)) {
    throw new Error('Update recovery resolution does not match the predecessor lock')
  }
  assertApprovedLockFields(lock)
  const metadata = loadCanonicalTemplateMetadata()
  const fragments = metadata.fragments.filter(
    ({ id }) => id === 'base' || manifest.capabilities.includes(id as never),
  )
  await assertFragmentsUnchanged(lock, fragments)
  await assertPredecessorComposers(lock, metadata, manifest)
  assertExactOutputSet(lock, applicableComposers(metadata.composers, manifest))
  const composed = await composeStructuredOutputs(templateRoot, metadata, manifest)
  const desiredLock = await buildDesiredLock(userManifest, manifest, metadata, composed)
  const expected: JournalEntry[] = []
  for (const output of composed) {
    const before = lock.outputs.find(({ path }) => path === output.path)
    if (!before) throw new Error(`Update recovery predecessor output is missing: ${output.path}`)
    const afterChecksum = sha256(output.content)
    if (before.checksum !== afterChecksum || before.mode !== generatedFileMode) {
      expected.push({
        path: output.path,
        backupPath: `${journal.backupRoot}/${output.path}`,
        beforeChecksum: before.checksum,
        afterChecksum,
        beforeMode: before.mode,
        afterMode: generatedFileMode,
      })
    }
  }
  const desiredLockBytes = Buffer.from(formatJsonDocument(desiredLock))
  expected.push({
    path: lockRelativePath,
    backupPath: `${journal.backupRoot}/${lockRelativePath}`,
    beforeChecksum: sha256(lockBytes),
    afterChecksum: sha256(desiredLockBytes),
    beforeMode: generatedFileMode,
    afterMode: generatedFileMode,
  })
  const sortEntries = (entries: readonly JournalEntry[]) =>
    [...entries].sort((left, right) => left.path.localeCompare(right.path))
  if (stableJson(sortEntries(journal.entries)) !== stableJson(sortEntries(expected))) {
    throw new Error('Update recovery journal does not match the exact expected change set')
  }
}

async function assertJournalTargetStates(
  target: string,
  journal: UpdateJournal,
  side: 'before' | 'after',
): Promise<void> {
  for (const entry of journal.entries) {
    await assertSafeAncestors(target, entry.path)
    await assertExpectedFileState(safeTargetPath(target, entry.path), entry.path, [
      side === 'before'
        ? { checksum: entry.beforeChecksum, mode: entry.beforeMode }
        : { checksum: entry.afterChecksum, mode: entry.afterMode },
    ])
  }
}

async function assertNoPendingJournal(target: string): Promise<void> {
  try {
    await access(safeTargetPath(target, journalRelativePath))
  } catch {
    return
  }
  throw new Error('Pending update journal requires create-cornerstone update recovery')
}

async function rollbackJournal(target: string, journal: UpdateJournal): Promise<void> {
  await assertDirectory(safeTargetPath(target, '.cornerstone'), '.cornerstone')
  await assertExactDirectoryWithinTarget(target, journal.backupRoot)
  for (const entry of journal.entries) {
    await assertSafeAncestors(target, entry.backupPath)
    const backup = safeTargetPath(target, entry.backupPath)
    const info = await lstat(backup)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      sha256(await readGeneratedFile(backup, `Update backup ${entry.path}`)) !==
        entry.beforeChecksum ||
      (info.mode & 0o777) !== entry.beforeMode
    ) {
      throw new Error(`Update recovery backup is invalid: ${entry.path}`)
    }
    const current = safeTargetPath(target, entry.path)
    await assertSafeAncestors(target, entry.path)
    const currentInfo = await lstat(current)
    const currentState = {
      checksum: sha256(await readGeneratedFile(current, `Update current output ${entry.path}`)),
      mode: currentInfo.mode & 0o777,
    }
    if (
      !currentInfo.isFile() ||
      currentInfo.isSymbolicLink() ||
      !matchesExpectedState(currentState, [
        { checksum: entry.beforeChecksum, mode: entry.beforeMode },
        { checksum: entry.afterChecksum, mode: entry.afterMode },
      ])
    ) {
      throw new Error(`Update recovery found concurrent modification: ${entry.path}`)
    }
  }
  for (const entry of journal.entries) {
    await replaceFile(
      target,
      entry.path,
      await readGeneratedFile(
        safeTargetPath(target, entry.backupPath),
        `Update backup ${entry.path}`,
      ),
      entry.beforeMode,
      [
        { checksum: entry.beforeChecksum, mode: entry.beforeMode },
        { checksum: entry.afterChecksum, mode: entry.afterMode },
      ],
    )
  }
  journal.status = 'rolled-back'
  await writeJournal(target, journal)
  await runUpdateHookForTest('after-rollback-before-cleanup')
  failUpdateIfInjected('after-rollback-before-cleanup')
  await cleanupJournal(target, journal)
}

async function cleanupJournal(target: string, journal: UpdateJournal): Promise<void> {
  try {
    await removeValidatedDirectory(target, journal.backupRoot)
    if (journal.status === 'rolled-back') {
      await runUpdateHookForTest('after-rollback-backup-cleanup')
      failUpdateIfInjected('after-rollback-backup-cleanup')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await assertOwnedWriteAncestors(target, journalRelativePath)
  await rm(safeTargetPath(target, journalRelativePath))
  await syncDirectory(safeTargetPath(target, '.cornerstone'))
}

async function cleanupPreparingJournal(target: string, journal: UpdateJournal): Promise<void> {
  try {
    await removeValidatedDirectory(target, journal.backupRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await assertOwnedWriteAncestors(target, journalRelativePath)
  await rm(safeTargetPath(target, journalRelativePath))
  await syncDirectory(safeTargetPath(target, '.cornerstone'))
}

export async function removeValidatedDirectory(target: string, path: string): Promise<void> {
  await assertOwnedWriteAncestors(target, path)
  await assertExactDirectoryWithinTarget(target, path)
  const directory = safeTargetPath(target, path)
  const before = await lstat(directory)
  const current = await lstat(directory)
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== before.dev ||
    current.ino !== before.ino
  ) {
    throw new Error(`Update cleanup directory identity changed: ${path}`)
  }
  await rm(directory, { recursive: true })
  await syncDirectory(dirname(directory))
}

export async function assertDirectory(path: string, label: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Update recovery path must be a real directory: ${label}`)
  }
}

export async function assertProjectBoundary(target: string): Promise<string> {
  const targetInfo = await lstat(target)
  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
    throw new Error('Update target must be a real directory')
  }
  const targetReal = await realpath(target)
  const cornerstone = safeTargetPath(target, '.cornerstone')
  const cornerstoneInfo = await lstat(cornerstone)
  if (!cornerstoneInfo.isDirectory() || cornerstoneInfo.isSymbolicLink()) {
    throw new Error('.cornerstone must be a real directory')
  }
  const cornerstoneReal = await realpath(cornerstone)
  if (!isWithinRealRoot(targetReal, cornerstoneReal)) {
    throw new Error('.cornerstone resolves outside the update target')
  }
  return targetReal
}

async function assertUpdateOwnershipBoundary(target: string): Promise<void> {
  if (process.platform === 'win32' || typeof process.geteuid !== 'function') return
  const effectiveUserId = process.geteuid()
  if (effectiveUserId === 0) {
    throw new Error('Actual update must not run with root or elevated privileges')
  }
  await assertSecureTargetParentChain(target, effectiveUserId)
  const lockBytes = await readBoundedFile(
    safeTargetPath(target, lockRelativePath),
    'Project lock manifest',
  )
  const lock = projectLockV2Schema.parse(JSON.parse(lockBytes.toString('utf8')))
  const paths = new Set([
    lockRelativePath,
    journalRelativePath,
    updateLockRelativePath,
    ...lock.outputs.map(({ path }) => path),
    ...loadCanonicalTemplateMetadata().composers.map(({ output }) => output),
  ])
  if (await pathExists(safeTargetPath(target, journalRelativePath))) {
    const journal = parseJournal(
      JSON.parse(
        (
          await readBoundedFile(safeTargetPath(target, journalRelativePath), 'Update journal')
        ).toString('utf8'),
      ),
    )
    paths.add(journal.backupRoot)
    if (await pathExists(safeTargetPath(target, journal.backupRoot))) {
      for (const entry of journal.entries) paths.add(entry.backupPath)
    }
  }
  for (const path of paths) await assertOwnedWriteAncestors(target, path, effectiveUserId)
}

export async function assertMutationOwnershipBoundary(target: string): Promise<void> {
  if (process.platform === 'win32' || typeof process.geteuid !== 'function') return
  const effectiveUserId = process.geteuid()
  if (effectiveUserId === 0) {
    throw new Error('Actual mutation must not run with root or elevated privileges')
  }
  await assertSecureTargetParentChain(target, effectiveUserId)
  const targetReal = await assertProjectBoundary(target)
  await assertOwnedDirectory(target, 'Mutation target', effectiveUserId, targetReal)
  await assertOwnedDirectory(
    safeTargetPath(target, '.cornerstone'),
    '.cornerstone',
    effectiveUserId,
    targetReal,
  )
}

async function assertSecureTargetParentChain(
  target: string,
  effectiveUserId: number,
): Promise<void> {
  const chain: string[] = []
  let child = await realpath(target)
  while (true) {
    const parent = dirname(child)
    if (parent === child) break
    chain.push(child)
    child = parent
  }
  for (const childPath of chain.reverse()) {
    const parentPath = dirname(childPath)
    const parentInfo = await lstat(parentPath)
    const childInfo = await lstat(childPath)
    if (
      !parentInfo.isDirectory() ||
      parentInfo.isSymbolicLink() ||
      !childInfo.isDirectory() ||
      childInfo.isSymbolicLink()
    ) {
      throw new Error('Update target parent chain must contain only real directories')
    }
    if (
      !isTrustedUpdateParentPolicy({
        parentUserId: parentInfo.uid,
        parentMode: parentInfo.mode,
        childUserId: childInfo.uid,
        effectiveUserId,
      })
    ) {
      throw new Error(
        'Update target parent chain has an untrusted owner, writable non-sticky directory, or unowned sticky child',
      )
    }
  }
}

export async function assertOwnedWriteAncestors(
  target: string,
  path: string,
  effectiveUserId = effectiveUpdateUserId(),
): Promise<void> {
  if (effectiveUserId < 0) return
  const targetReal = await assertProjectBoundary(target)
  let current = target
  await assertOwnedDirectory(current, 'Update target', effectiveUserId, targetReal)
  for (const segment of path.split('/').slice(0, -1)) {
    current = join(current, segment)
    await assertOwnedDirectory(current, path, effectiveUserId, targetReal)
  }
}

async function assertOwnedDirectory(
  path: string,
  label: string,
  effectiveUserId = effectiveUpdateUserId(),
  targetReal?: string,
): Promise<void> {
  if (effectiveUserId < 0) return
  const info = await lstat(path)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== effectiveUserId ||
    (info.mode & 0o022) !== 0
  ) {
    throw new Error(
      `Update write ancestor ${label} must be an effective-user-owned real directory and must not be group/world writable`,
    )
  }
  if (targetReal && !isWithinRealRoot(targetReal, await realpath(path))) {
    throw new Error(`Update write ancestor resolves outside target: ${label}`)
  }
}

function effectiveUpdateUserId(): number {
  if (process.platform === 'win32' || typeof process.geteuid !== 'function') return -1
  return process.geteuid()
}

export async function assertSafeAncestors(target: string, path: string): Promise<void> {
  const targetReal = await assertProjectBoundary(target)
  const segments = path.split('/').slice(0, -1)
  let current = target
  for (const segment of segments) {
    current = join(current, segment)
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`Update path ancestor must be a real directory: ${path}`)
    }
    if (!isWithinRealRoot(targetReal, await realpath(current))) {
      throw new Error(`Update path ancestor resolves outside target: ${path}`)
    }
  }
}

export async function assertExactDirectoryWithinTarget(
  target: string,
  path: string,
): Promise<void> {
  await assertSafeAncestors(target, `${path}/sentinel`)
  const directory = safeTargetPath(target, path)
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Update path must be a real directory: ${path}`)
  }
  const root = await realpath(target)
  if (!isWithinRealRoot(root, await realpath(directory))) {
    throw new Error(`Update directory resolves outside target: ${path}`)
  }
}

async function assertSafeRegularFile(target: string, path: string): Promise<void> {
  await assertSafeAncestors(target, path)
  const file = safeTargetPath(target, path)
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Update path must be a regular file: ${path}`)
  }
  if (!isWithinRealRoot(await realpath(target), await realpath(file))) {
    throw new Error(`Update file resolves outside target: ${path}`)
  }
}

function isWithinRealRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

async function writeJournal(target: string, journal: UpdateJournal): Promise<void> {
  await replaceFile(
    target,
    journalRelativePath,
    Buffer.from(formatJsonDocument(journal)),
    generatedFileMode,
  )
}

export async function replaceFile(
  target: string,
  path: string,
  content: Uint8Array,
  mode: number,
  expectedStates?: readonly ExpectedFileState[],
): Promise<void> {
  assertGeneratedSize(content, path)
  await assertOwnedWriteAncestors(target, path)
  await assertSafeAncestors(target, path)
  const output = safeTargetPath(target, path)
  const temporary = join(
    dirname(output),
    `.${basename(output)}.cornerstone-update-${randomUUID()}.tmp`,
  )
  try {
    await writeNewDurableFile(temporary, content, mode)
    await runUpdateHookForTest('before-temp-rename', path)
    failUpdateIfInjected('before-temp-rename')
    if (expectedStates) await assertExpectedFileState(output, path, expectedStates)
    await rename(temporary, output)
    await syncDirectory(dirname(output))
  } finally {
    await assertOwnedWriteAncestors(target, path)
    await rm(temporary, { force: true })
  }
}

export async function writeNewDurableFile(
  path: string,
  content: Uint8Array,
  mode: number,
): Promise<void> {
  assertGeneratedSize(content, path)
  const handle = await open(path, 'wx', mode)
  try {
    await handle.writeFile(content)
    await handle.chmod(mode)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  let handle
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (error) {
    if (
      !['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    ) {
      throw error
    }
  } finally {
    await handle?.close()
  }
}

export async function assertExpectedFileState(
  path: string,
  label: string,
  expectedStates: readonly ExpectedFileState[],
): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Update replacement precondition changed: ${label}`)
  }
  const actual = {
    checksum: sha256(await readGeneratedFile(path, `Generated update file ${label}`)),
    mode: info.mode & 0o777,
  }
  if (!matchesExpectedState(actual, expectedStates)) {
    throw new Error(`Update replacement precondition changed: ${label}`)
  }
}

function matchesExpectedState(
  actual: ExpectedFileState,
  expected: readonly ExpectedFileState[],
): boolean {
  return expected.some(({ checksum, mode }) => actual.checksum === checksum && actual.mode === mode)
}

async function assertLockedOutputs(target: string, lock: ProjectLockV2Data): Promise<void> {
  for (const output of lock.outputs) {
    await assertSafeAncestors(target, output.path)
    const path = safeTargetPath(target, output.path)
    const info = await lstat(path)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      sha256(await readGeneratedFile(path, `Generator-owned output ${output.path}`)) !==
        output.checksum ||
      (info.mode & 0o777) !== output.mode
    ) {
      throw new Error(`Generator-owned shared file was modified: ${output.path}`)
    }
  }
}

async function assertFragmentsUnchanged(
  lock: ProjectLockV2Data,
  fragments: readonly { id: string; version: number }[],
): Promise<void> {
  if (lock.fragments.length !== fragments.length) {
    throw new Error('Manual migration required: fragment set changed')
  }
  for (const fragment of fragments) {
    const locked = lock.fragments.find(({ id }) => id === fragment.id)
    const checksum = await directoryChecksum(join(templateRoot, 'fragments', fragment.id))
    if (!locked || locked.version !== fragment.version || locked.checksum !== checksum) {
      throw new Error(`Manual migration required: fragment ${fragment.id} changed`)
    }
  }
}

function applicableComposers(
  definitions: readonly ComposerDefinition[],
  manifest: ResolvedManifest,
): ComposerDefinition[] {
  return definitions.filter(
    ({ format }) =>
      format !== 'license' || (!!manifest.license && manifest.license !== 'UNLICENSED'),
  )
}

function assertApprovedLockFields(lock: ProjectLockV2Data): void {
  if (
    lock.generatorVersion !== approvedGeneratorVersion ||
    stableJson(lock.compatibility) !== stableJson(approvedCompatibility) ||
    stableJson(lock.baselines) !== stableJson(approvedBaselines) ||
    stableJson(lock.certification) !== stableJson(approvedCertification) ||
    stableJson(lock.resolved.providers) !== stableJson({})
  ) {
    throw new Error('Manual migration required: predecessor release contract changed')
  }
}

function assertExactOutputSet(
  lock: ProjectLockV2Data,
  composers: readonly ComposerDefinition[],
): void {
  const expected = composers
    .map(({ id, output }) => ({ path: output, owner: id }))
    .sort((left, right) => left.path.localeCompare(right.path))
  const actual = lock.outputs
    .map(({ path, owner }) => ({ path, owner }))
    .sort((left, right) => left.path.localeCompare(right.path))
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error('Manual migration required: composer output path/owner set changed')
  }
}

async function assertPredecessorComposers(
  lock: ProjectLockV2Data,
  metadata: CanonicalTemplateMetadata,
  manifest: ResolvedManifest,
): Promise<void> {
  const applicable = applicableComposers(metadata.composers, manifest)
  if (lock.composers.length !== applicable.length) {
    throw new Error('Manual migration required: composer set changed')
  }
  for (const current of applicable) {
    const predecessor = current.id === 'project-readme' ? { ...current, version: 1 } : current
    const expectedChecksum = await composerChecksum(predecessor, metadata)
    const locked = lock.composers.find(({ id }) => id === predecessor.id)
    if (!locked || locked.version !== predecessor.version || locked.checksum !== expectedChecksum) {
      throw new Error(
        `Manual migration required: predecessor composer ${predecessor.id} is incompatible`,
      )
    }
  }
  const readme = lock.outputs.find(({ owner }) => owner === 'project-readme')
  if (
    !readme ||
    readme.checksum !== sha256(composePredecessorReadme(manifest, lock.certification.matrix))
  ) {
    throw new Error('Manual migration required: predecessor README contract is incompatible')
  }
  const currentOutputs = await composeStructuredOutputs(templateRoot, metadata, manifest)
  for (const output of currentOutputs) {
    const locked = lock.outputs.find(
      ({ path, owner }) => path === output.path && owner === output.owner,
    )
    const expectedContent =
      output.owner === 'project-readme'
        ? composePredecessorReadme(manifest, lock.certification.matrix)
        : output.content
    if (
      !locked ||
      locked.mode !== generatedFileMode ||
      locked.checksum !== sha256(expectedContent)
    ) {
      throw new Error(
        `Manual migration required: predecessor output ${output.path} is incompatible`,
      )
    }
  }
}

async function assertCurrentComposers(
  lock: ProjectLockV2Data,
  metadata: CanonicalTemplateMetadata,
  manifest: ResolvedManifest,
): Promise<void> {
  const applicable = applicableComposers(metadata.composers, manifest)
  if (lock.composers.length !== applicable.length) {
    throw new Error('Current Standard composer set is incompatible')
  }
  for (const definition of applicable) {
    const locked = lock.composers.find(({ id }) => id === definition.id)
    if (
      !locked ||
      locked.version !== definition.version ||
      locked.checksum !== (await composerChecksum(definition, metadata))
    ) {
      throw new Error(`Current Standard composer ${definition.id} is incompatible`)
    }
  }
}

async function buildDesiredLock(
  userManifest: ProjectManifest,
  manifest: ResolvedManifest,
  metadata: CanonicalTemplateMetadata,
  outputs: readonly { owner: string; path: string; content: Uint8Array }[],
): Promise<ProjectLockV2Data> {
  const composers = await Promise.all(
    applicableComposers(metadata.composers, manifest).map(async (definition) => ({
      id: definition.id,
      version: definition.version,
      checksum: await composerChecksum(definition, metadata),
    })),
  )
  const fragments = await Promise.all(
    loadCanonicalTemplateMetadata()
      .fragments.filter(({ id }) => id === 'base' || manifest.capabilities.includes(id as never))
      .map(async ({ id, version }) => ({
        id,
        version,
        checksum: await directoryChecksum(join(templateRoot, 'fragments', id)),
      })),
  )
  const unsigned = {
    schemaVersion: 2 as const,
    generatorVersion: approvedGeneratorVersion,
    templateVersion: currentTemplateVersion,
    userManifestDigest: sha256(stableJson(userManifest)),
    resolved: manifest,
    compatibility: approvedCompatibility,
    baselines: approvedBaselines,
    fragments: fragments.sort((left, right) => left.id.localeCompare(right.id)),
    composers: composers.sort((left, right) => left.id.localeCompare(right.id)),
    outputs: outputs
      .map((output) => ({
        path: output.path,
        owner: output.owner,
        checksum: sha256(output.content),
        mode: generatedFileMode,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    certification: approvedCertification,
  }
  return { ...unsigned, integrity: sha256(stableJson(unsigned)) }
}

async function composerChecksum(
  composer: ComposerDefinition,
  metadata: CanonicalTemplateMetadata,
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
    sources.generator = sha256(await readFile(join(import.meta.dirname, '..', '..', 'NOTICE')))
    for (const fragment of metadata.fragments) {
      sources[`fragment-${fragment.id}`] = await noticeChecksum(
        join(templateRoot, 'fragments', fragment.id),
      )
    }
  }
  return sha256(stableJson({ definition: composer, sources }))
}

function assertExactStandard(manifest: ResolvedManifest): void {
  const exact = [...loadCanonicalTemplateMetadata().profiles.standard.capabilities].sort()
  if (manifest.profile !== 'standard' || stableJson(manifest.capabilities) !== stableJson(exact)) {
    throw new Error('Update supports only the exact Standard v2 composition')
  }
}

function assertIntegrity(lock: ProjectLockV2Data): void {
  const { integrity, ...unsigned } = lock
  if (sha256(stableJson(unsigned)) !== integrity) {
    throw new Error('Lock manifest integrity mismatch')
  }
}

async function readManifest(path: string): Promise<ProjectManifest> {
  const source = (await readBoundedFile(path, 'Project manifest')).toString('utf8')
  const document = parseDocument(source)
  if (document.errors.length > 0) throw document.errors[0]
  return projectManifestSchema.parse(document.toJS({ maxAliasCount: 0 }))
}

export async function readBoundedFile(
  path: string,
  label: string,
  limit = maximumMetadataBytes,
): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    const limitLabel = limit === maximumMetadataBytes ? '1 MiB' : '16 MiB'
    if (!info.isFile() || info.size > limit) {
      throw new Error(`${label} exceeds the ${limitLabel} input limit or is not a regular file`)
    }
    const buffer = Buffer.alloc(Math.min(info.size + 1, limit + 1))
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > limit) throw new Error(`${label} exceeds the ${limitLabel} input limit`)
    if (total > info.size) throw new Error(`${label} changed while it was being read`)
    return buffer.subarray(0, total)
  } finally {
    await handle.close()
  }
}

export async function readGeneratedFile(path: string, label: string): Promise<Buffer> {
  return readBoundedFile(path, label, maximumGeneratedFileBytes)
}

export function assertGeneratedSize(content: Uint8Array, label: string): void {
  if (content.byteLength > maximumGeneratedFileBytes) {
    throw new Error(`${label} exceeds the 16 MiB generated-file limit`)
  }
}

function parseJournal(value: unknown): UpdateJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid update journal')
  }
  const journal = value as UpdateJournal
  const allowedPaths = new Set([
    lockRelativePath,
    ...loadCanonicalTemplateMetadata().composers.map(({ output }) => output),
  ])
  if (
    !hasExactKeys(journal as unknown as Record<string, unknown>, [
      'schemaVersion',
      'operationId',
      'backupRoot',
      'status',
      'entries',
    ]) ||
    journal.schemaVersion !== 1 ||
    !uuidPattern.test(journal.operationId) ||
    journal.backupRoot !== `.cornerstone/update-backup-${journal.operationId}` ||
    !['preparing', 'pending', 'rolled-back', 'committed'].includes(journal.status) ||
    !Array.isArray(journal.entries) ||
    (journal.status !== 'preparing' && journal.entries.length === 0)
  ) {
    throw new Error('Invalid update journal')
  }
  const paths = new Set<string>()
  for (const entry of journal.entries) {
    if (
      !entry ||
      !hasExactKeys(entry as unknown as Record<string, unknown>, [
        'path',
        'backupPath',
        'beforeChecksum',
        'afterChecksum',
        'beforeMode',
        'afterMode',
      ]) ||
      typeof entry.path !== 'string' ||
      !allowedPaths.has(entry.path) ||
      paths.has(entry.path) ||
      entry.backupPath !== `${journal.backupRoot}/${entry.path}` ||
      !digestPattern.test(entry.beforeChecksum) ||
      !digestPattern.test(entry.afterChecksum) ||
      !Number.isInteger(entry.beforeMode) ||
      entry.beforeMode < 0 ||
      entry.beforeMode > 0o777 ||
      entry.afterMode !== generatedFileMode
    ) {
      throw new Error('Invalid update journal entry')
    }
    paths.add(entry.path)
  }
  if (journal.status !== 'preparing' && !paths.has(lockRelativePath)) {
    throw new Error('Invalid update journal: lock entry missing')
  }
  return journal
}

export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return stableJson(actual) === stableJson([...expected].sort())
}

function lineDiff(before: string, after: string): string {
  const left = before.split('\n')
  const right = after.split('\n')
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1
  let leftEnd = left.length - 1
  let rightEnd = right.length - 1
  while (leftEnd >= start && rightEnd >= start && left[leftEnd] === right[rightEnd]) {
    leftEnd -= 1
    rightEnd -= 1
  }
  return [
    '--- README.md',
    '+++ README.md',
    ...left.slice(start, leftEnd + 1).map((line) => `-${line}`),
    ...right.slice(start, rightEnd + 1).map((line) => `+${line}`),
  ].join('\n')
}

export function safeTargetPath(target: string, path: string): string {
  if (
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe update path: ${path}`)
  }
  const output = resolve(target, path)
  if (
    !output.startsWith(`${target}${sep}`) ||
    relative(target, output).split(sep).join('/') !== path
  ) {
    throw new Error(`Update path escapes target: ${path}`)
  }
  return output
}

async function directoryChecksum(directory: string): Promise<string> {
  const entries: string[] = []
  await collectFiles(directory, '', entries)
  return sha256(entries.sort().join('\n'))
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
