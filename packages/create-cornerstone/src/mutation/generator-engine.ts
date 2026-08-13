import { randomUUID } from 'node:crypto'
import { access, chmod, lstat, mkdir, rm, rmdir } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { formatJsonDocument } from '../composition/composer.js'
import { sha256, stableJson } from '../hash.js'
import {
  isGeneratorControlPath,
  portableScaffoldPathsConflict,
  scaffoldPathSchema,
} from '../scaffold/registry.js'
import {
  failMutationCrashIfInjected,
  failUpdateIfInjected,
  isInjectedMutationCrash,
  runUpdateHookForTest,
} from './test-controls.js'
import {
  assertDirectory,
  assertExactDirectoryWithinTarget,
  assertExpectedFileState,
  assertGeneratedSize,
  assertMutationOwnershipBoundary,
  assertOwnedWriteAncestors,
  assertProjectBoundary,
  assertSafeAncestors,
  ensureBackupParents,
  generatedFileMode,
  hasExactKeys,
  lockRelativePath,
  maximumMetadataBytes,
  pathExists,
  readBoundedFile,
  readGeneratedFile,
  removeValidatedDirectory,
  replaceFile,
  safeTargetPath,
  syncBackupDirectories,
  syncDirectory,
  withUpdateOperationLock,
  writeNewDurableFile,
} from './update-engine.js'

const journalRelativePath = '.cornerstone/mutation.journal.json'
const updateJournalRelativePath = '.cornerstone/update.journal.json'
const digestPattern = /^sha256:[a-f0-9]{64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type MutationOperationKind = 'update' | 'generate'
export type MutationAction = 'add' | 'modify' | 'delete'

export interface GeneratorMutationInput {
  action: MutationAction
  path: string
  content?: Uint8Array
  mode?: number
  beforeChecksum?: string
  beforeMode?: number
}

export interface GeneratorMutationRequest {
  operationKind: MutationOperationKind
  lockPath: string
  createdDirectories: readonly string[]
  entries: readonly GeneratorMutationInput[]
}

export interface GeneratorMutationChange {
  action: MutationAction
  path: string
  beforeChecksum: string | null
  beforeMode: number | null
  afterChecksum: string | null
  afterMode: number | null
}

export interface GeneratorMutationPlan {
  schemaVersion: 1
  operationKind: MutationOperationKind
  target: string
  lockPath: string
  createdDirectories: string[]
  changes: GeneratorMutationChange[]
}

export interface MutationJournalV2Entry extends GeneratorMutationChange {
  backupPath: string | null
}

export interface MutationJournalV2 {
  schemaVersion: 2
  operationId: string
  operationKind: MutationOperationKind
  backupRoot: string
  status: 'preparing' | 'pending' | 'committed' | 'rolled-back'
  createdDirectories: string[]
  entries: MutationJournalV2Entry[]
}

interface PreparedMutation {
  plan: GeneratorMutationPlan
  contents: Map<string, Uint8Array>
}

export async function planGeneratorMutation(
  targetPath: string,
  request: GeneratorMutationRequest,
): Promise<GeneratorMutationPlan> {
  const target = await assertProjectBoundary(resolve(targetPath))
  await assertNoJournal(target)
  validateRequest(request)
  await assertRequestedDirectoriesMatch(target, request)
  return (await prepareMutation(target, request, false)).plan
}

export async function applyGeneratorMutation(
  targetPath: string,
  request: GeneratorMutationRequest,
  options: { dryRun?: boolean } = {},
): Promise<GeneratorMutationPlan> {
  if (options.dryRun) return planGeneratorMutation(targetPath, request)
  const target = await assertProjectBoundary(resolve(targetPath))
  validateRequest(request)
  await assertMutationOwnershipBoundary(target)
  for (const entry of request.entries) {
    if (entry.action === 'add') await assertExistingAddParent(target, entry.path, true)
    else await assertOwnedWriteAncestors(target, entry.path)
  }
  await assertOwnedWriteAncestors(target, journalRelativePath)
  return withUpdateOperationLock(target, async () => {
    const recovery = await recoverGeneratorMutation(target, request)
    if (recovery !== 'committed') await assertRequestedDirectoriesMatch(target, request)
    const prepared = await prepareMutation(target, request, recovery === 'committed')
    if (recovery === 'committed') return prepared.plan
    await applyPreparedMutation(target, prepared)
    return prepared.plan
  })
}

async function prepareMutation(
  target: string,
  request: GeneratorMutationRequest,
  allowApplied: boolean,
): Promise<PreparedMutation> {
  validateRequest(request)
  const contents = new Map<string, Uint8Array>()
  const changes: GeneratorMutationChange[] = []
  for (const input of request.entries) {
    if (input.action === 'delete') {
      throw new Error('Mutation delete execution is reserved for a future journal contract')
    }
    const content = input.content
    if (!content) throw new Error(`Mutation content is required: ${input.path}`)
    assertGeneratedSize(content, input.path)
    const afterChecksum = sha256(content)
    const afterMode = input.mode ?? generatedFileMode
    assertMode(afterMode, `Mutation mode for ${input.path}`)
    if (input.action === 'add') await assertExistingAddParent(target, input.path)
    else await assertSafeAncestors(target, input.path)
    const output = safeTargetPath(target, input.path)
    if (input.action === 'add') {
      if (await pathExists(output)) {
        if (!allowApplied || !(await matchesFile(output, afterChecksum, afterMode))) {
          throw new Error(`Mutation add target must be absent: ${input.path}`)
        }
      }
      changes.push({
        action: 'add',
        path: input.path,
        beforeChecksum: null,
        beforeMode: null,
        afterChecksum,
        afterMode,
      })
    } else {
      if (!digestPattern.test(input.beforeChecksum ?? ''))
        throw new Error(`Mutation modify before checksum is required: ${input.path}`)
      assertMode(input.beforeMode, `Mutation before mode for ${input.path}`)
      if (
        !(await matchesFile(output, input.beforeChecksum!, input.beforeMode!)) &&
        (!allowApplied || !(await matchesFile(output, afterChecksum, afterMode)))
      ) {
        throw new Error(`Mutation modify precondition changed: ${input.path}`)
      }
      changes.push({
        action: 'modify',
        path: input.path,
        beforeChecksum: input.beforeChecksum!,
        beforeMode: input.beforeMode!,
        afterChecksum,
        afterMode,
      })
    }
    contents.set(input.path, content)
  }
  return {
    plan: {
      schemaVersion: 1,
      operationKind: request.operationKind,
      target,
      lockPath: request.lockPath,
      createdDirectories: [...request.createdDirectories],
      changes,
    },
    contents,
  }
}

function validateRequest(request: GeneratorMutationRequest): void {
  if (!['update', 'generate'].includes(request.operationKind))
    throw new Error('Invalid mutation operation kind')
  if (!Array.isArray(request.entries)) throw new Error('Mutation entries must be an array')
  if (request.entries.length === 0) throw new Error('Mutation request must contain entries')
  if (request.lockPath !== lockRelativePath)
    throw new Error('Mutation lock path must be the manifest lock')
  if (!Array.isArray(request.createdDirectories))
    throw new Error('Mutation created directories must be an array')
  const paths: string[] = []
  for (const entry of request.entries) {
    if (!entry || !['add', 'modify', 'delete'].includes(entry.action)) {
      throw new Error('Invalid mutation action')
    }
    if (typeof entry.path !== 'string') throw new Error('Invalid mutation path')
    assertPortableMutationPath(entry.path, 'Mutation path')
    if (entry.path !== lockRelativePath && isGeneratorControlPath(entry.path)) {
      throw new Error(`Mutation path conflicts with the generator control namespace: ${entry.path}`)
    }
    if (paths.some((path) => portableScaffoldPathsConflict(path, entry.path))) {
      throw new Error(`Mutation paths have a portable or ancestor collision: ${entry.path}`)
    }
    paths.push(entry.path)
  }
  if (!paths.includes(request.lockPath))
    throw new Error('Mutation request must include the lock path')
  const lockEntry = request.entries.find(({ path }) => path === request.lockPath)
  if (lockEntry?.action !== 'modify') {
    throw new Error('Mutation request must modify the manifest lock')
  }
  const addPaths = request.entries.filter(({ action }) => action === 'add').map(({ path }) => path)
  const expectedOrder = [...request.createdDirectories].sort(compareDirectories)
  if (stableJson(request.createdDirectories) !== stableJson(expectedOrder)) {
    throw new Error('Mutation created directories must be uniquely sorted parent-first')
  }
  const directories: string[] = []
  for (const directory of request.createdDirectories) {
    assertPortableMutationPath(directory, 'Mutation created directory')
    if (isGeneratorControlPath(directory)) {
      throw new Error(
        `Mutation created directory conflicts with the generator control namespace: ${directory}`,
      )
    }
    if (directories.some((candidate) => portablePathEqual(candidate, directory))) {
      throw new Error(`Mutation created directories have a portable collision: ${directory}`)
    }
    if (!addPaths.some((path) => path.startsWith(`${directory}/`))) {
      throw new Error(`Mutation created directory is not an add ancestor: ${directory}`)
    }
    directories.push(directory)
  }
}

async function applyPreparedMutation(target: string, prepared: PreparedMutation): Promise<void> {
  if (prepared.plan.changes.length === 0) return
  const operationId = randomUUID()
  const backupRoot = `.cornerstone/mutation-backup-${operationId}`
  const journal: MutationJournalV2 = {
    schemaVersion: 2,
    operationId,
    operationKind: prepared.plan.operationKind,
    backupRoot,
    status: 'preparing',
    createdDirectories: [...prepared.plan.createdDirectories],
    entries: [],
  }
  journal.entries = prepared.plan.changes.map((change) => journalEntry(journal, change))
  await assertDirectory(safeTargetPath(target, '.cornerstone'), '.cornerstone')
  await writeJournal(target, journal)
  failMutationCrashIfInjected('mutation-crash-after-journal')
  let backupRootCreated = false
  try {
    await mkdir(safeTargetPath(target, backupRoot), { recursive: false, mode: 0o700 })
    backupRootCreated = true
    for (const directory of journal.createdDirectories) {
      await assertExistingAddParent(target, `${directory}/sentinel`, true)
      if (await pathExists(safeTargetPath(target, directory))) {
        throw new Error(`Mutation created directory must be absent: ${directory}`)
      }
      const directoryPath = safeTargetPath(target, directory)
      await mkdir(directoryPath, { recursive: false, mode: 0o755 })
      await chmod(directoryPath, 0o755)
      await syncDirectory(dirname(directoryPath))
    }
    for (const change of prepared.plan.changes) {
      const entry = journal.entries.find(({ path }) => path === change.path)!
      if (change.action === 'modify') {
        await assertBeforeState(target, change)
        await ensureBackupParents(target, backupRoot, change.path)
        const backup = safeTargetPath(target, entry.backupPath!)
        await writeNewDurableFile(
          backup,
          await readGeneratedFile(
            safeTargetPath(target, change.path),
            `Mutation source ${change.path}`,
          ),
          change.beforeMode!,
        )
        await syncDirectory(dirname(backup))
        await assertBeforeState(target, change)
      }
    }
    await syncBackupDirectories(
      target,
      backupRoot,
      journal.entries
        .filter((entry) => entry.backupPath !== null)
        .map((entry) => ({ backupPath: entry.backupPath! }) as never),
    )
    journal.status = 'pending'
    await writeJournal(target, journal)
  } catch (error) {
    if (backupRootCreated) await removeValidatedDirectory(target, backupRoot)
    await cleanupCreatedDirectories(target, journal.createdDirectories)
    await rm(safeTargetPath(target, journalRelativePath), { force: true })
    throw error
  }

  try {
    for (const change of orderLockLast(prepared.plan.changes, prepared.plan.lockPath)) {
      await applyChange(target, change, prepared.contents.get(change.path)!)
      await runUpdateHookForTest('mutation-after-write', change.path)
    }
    await runUpdateHookForTest('mutation-after-output')
    failMutationCrashIfInjected('mutation-crash-after-output')
    failUpdateIfInjected('mutation-after-output')
    journal.status = 'committed'
    await writeJournal(target, journal)
    failMutationCrashIfInjected('mutation-crash-after-commit')
  } catch (error) {
    if (isInjectedMutationCrash(error)) throw error
    await runUpdateHookForTest('mutation-before-rollback')
    await rollbackJournal(target, journal)
    throw error
  }
  await cleanupJournal(target, journal)
}

async function applyChange(
  target: string,
  change: GeneratorMutationChange,
  content: Uint8Array,
): Promise<void> {
  if (change.action === 'add') {
    const output = safeTargetPath(target, change.path)
    if (await pathExists(output))
      throw new Error(`Mutation add precondition changed: ${change.path}`)
    await assertOwnedWriteAncestors(target, change.path)
    await writeNewDurableFile(output, content, change.afterMode!)
    await syncDirectory(dirname(output))
    return
  }
  await replaceFile(target, change.path, content, change.afterMode!, [
    { checksum: change.beforeChecksum!, mode: change.beforeMode! },
  ])
}

async function recoverGeneratorMutation(
  target: string,
  request: GeneratorMutationRequest,
): Promise<'none' | 'rolled-back' | 'committed'> {
  if (await pathExists(safeTargetPath(target, updateJournalRelativePath))) {
    throw new Error('Pending update journal must be recovered by create-cornerstone update')
  }
  const journalPath = safeTargetPath(target, journalRelativePath)
  if (!(await pathExists(journalPath))) return 'none'
  const journal = parseMutationJournalV2(
    JSON.parse(
      (await readBoundedFile(journalPath, 'Mutation journal', maximumMetadataBytes)).toString(
        'utf8',
      ),
    ),
  )
  if (journal.operationKind !== request.operationKind)
    throw new Error('Mutation journal operation kind mismatch')
  const expected = expectedJournalEntries(journal, request)
  if (stableJson(journal.createdDirectories) !== stableJson(request.createdDirectories)) {
    throw new Error('Mutation journal created directories do not match the exact request')
  }
  if (stableJson(journal.entries) !== stableJson(expected)) {
    throw new Error('Mutation journal does not match the exact requested transition')
  }
  if (journal.status === 'preparing') {
    await cleanupPreparingJournal(target, journal)
    return 'none'
  }
  if (journal.status === 'committed') {
    await assertTargetSide(target, journal.entries, 'after')
    await validateBackupsIfPresent(target, journal)
    await cleanupJournal(target, journal)
    return 'committed'
  }
  if (journal.status === 'rolled-back') {
    await assertTargetSide(target, journal.entries, 'before')
    await validateBackupsIfPresent(target, journal)
    await cleanupCreatedDirectories(target, journal.createdDirectories)
    await cleanupJournal(target, journal)
    return 'rolled-back'
  }
  await validateBackups(target, journal)
  await rollbackJournal(target, journal)
  return 'rolled-back'
}

function expectedJournalEntries(
  journal: MutationJournalV2,
  request: GeneratorMutationRequest,
): MutationJournalV2Entry[] {
  validateRequest(request)
  return request.entries.map((input) => {
    const afterChecksum = input.action === 'delete' ? null : sha256(input.content!)
    const afterMode = input.action === 'delete' ? null : (input.mode ?? generatedFileMode)
    return {
      action: input.action,
      path: input.path,
      backupPath: input.action === 'add' ? null : `${journal.backupRoot}/${input.path}`,
      beforeChecksum: input.action === 'add' ? null : (input.beforeChecksum ?? null),
      beforeMode: input.action === 'add' ? null : (input.beforeMode ?? null),
      afterChecksum,
      afterMode,
    }
  })
}

function journalEntry(
  journal: MutationJournalV2,
  change: GeneratorMutationChange,
): MutationJournalV2Entry {
  return {
    ...change,
    backupPath: change.action === 'add' ? null : `${journal.backupRoot}/${change.path}`,
  }
}

async function rollbackJournal(target: string, journal: MutationJournalV2): Promise<void> {
  await validateBackups(target, journal)
  await assertTargetSide(target, journal.entries, 'before-or-after')
  for (const entry of orderLockLast(journal.entries, lockRelativePath)) {
    if (entry.action === 'add') {
      const output = safeTargetPath(target, entry.path)
      if (!(await pathExists(output))) continue
      await assertExpectedFileState(output, entry.path, [
        { checksum: entry.afterChecksum!, mode: entry.afterMode! },
      ])
      await rm(output)
      await syncDirectory(dirname(output))
    } else if (entry.action === 'modify') {
      await replaceFile(
        target,
        entry.path,
        await readGeneratedFile(
          safeTargetPath(target, entry.backupPath!),
          `Mutation backup ${entry.path}`,
        ),
        entry.beforeMode!,
        [
          { checksum: entry.beforeChecksum!, mode: entry.beforeMode! },
          { checksum: entry.afterChecksum!, mode: entry.afterMode! },
        ],
      )
    } else {
      throw new Error('Mutation delete rollback is not implemented')
    }
  }
  journal.status = 'rolled-back'
  await writeJournal(target, journal)
  failMutationCrashIfInjected('mutation-crash-after-rollback')
  await cleanupCreatedDirectories(target, journal.createdDirectories)
  await cleanupJournal(target, journal)
}

async function validateBackups(target: string, journal: MutationJournalV2): Promise<void> {
  await assertExactDirectoryWithinTarget(target, journal.backupRoot)
  for (const entry of journal.entries) {
    if (entry.action === 'add') continue
    await assertExpectedFileState(safeTargetPath(target, entry.backupPath!), entry.backupPath!, [
      { checksum: entry.beforeChecksum!, mode: entry.beforeMode! },
    ])
  }
}

async function validateBackupsIfPresent(target: string, journal: MutationJournalV2): Promise<void> {
  if (await pathExists(safeTargetPath(target, journal.backupRoot)))
    await validateBackups(target, journal)
}

async function assertTargetSide(
  target: string,
  entries: readonly MutationJournalV2Entry[],
  side: 'before' | 'after' | 'before-or-after',
): Promise<void> {
  for (const entry of entries) {
    const output = safeTargetPath(target, entry.path)
    if (entry.action === 'add') {
      const exists = await pathExists(output)
      if (side === 'before' && exists)
        throw new Error(`Mutation rollback add target still exists: ${entry.path}`)
      if (side === 'after' && !exists)
        throw new Error(`Mutation committed add target is missing: ${entry.path}`)
      if (exists)
        await assertExpectedFileState(output, entry.path, [
          { checksum: entry.afterChecksum!, mode: entry.afterMode! },
        ])
    } else {
      const states =
        side === 'before'
          ? [{ checksum: entry.beforeChecksum!, mode: entry.beforeMode! }]
          : side === 'after'
            ? [{ checksum: entry.afterChecksum!, mode: entry.afterMode! }]
            : [
                { checksum: entry.beforeChecksum!, mode: entry.beforeMode! },
                { checksum: entry.afterChecksum!, mode: entry.afterMode! },
              ]
      await assertExpectedFileState(output, entry.path, states)
    }
  }
}

async function assertBeforeState(target: string, change: GeneratorMutationChange): Promise<void> {
  await assertExpectedFileState(safeTargetPath(target, change.path), change.path, [
    { checksum: change.beforeChecksum!, mode: change.beforeMode! },
  ])
}

async function matchesFile(path: string, checksum: string, mode: number): Promise<boolean> {
  if (!(await pathExists(path))) return false
  const info = await lstat(path)
  return (
    info.isFile() &&
    !info.isSymbolicLink() &&
    (info.mode & 0o777) === mode &&
    sha256(await readGeneratedFile(path, path)) === checksum
  )
}

async function writeJournal(target: string, journal: MutationJournalV2): Promise<void> {
  await replaceFile(
    target,
    journalRelativePath,
    Buffer.from(formatJsonDocument(journal)),
    generatedFileMode,
  )
}

async function cleanupJournal(target: string, journal: MutationJournalV2): Promise<void> {
  try {
    await removeValidatedDirectory(target, journal.backupRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await rm(safeTargetPath(target, journalRelativePath))
  await syncDirectory(safeTargetPath(target, '.cornerstone'))
}

async function cleanupPreparingJournal(target: string, journal: MutationJournalV2): Promise<void> {
  await cleanupCreatedDirectories(target, journal.createdDirectories)
  await cleanupJournal(target, journal)
}

async function findMissingAddDirectories(
  target: string,
  entries: readonly GeneratorMutationInput[],
): Promise<string[]> {
  const directories = new Set<string>()
  for (const entry of entries) {
    if (entry.action !== 'add') continue
    let current = dirname(entry.path).split(sep).join('/')
    const missing: string[] = []
    while (current !== '.' && current !== '.cornerstone') {
      if (await pathExists(safeTargetPath(target, current))) break
      missing.push(current)
      current = dirname(current).split(sep).join('/')
    }
    for (const directory of missing.reverse()) directories.add(directory)
  }
  return [...directories].sort(compareDirectories)
}

async function assertRequestedDirectoriesMatch(
  target: string,
  request: GeneratorMutationRequest,
): Promise<void> {
  const missing = await findMissingAddDirectories(target, request.entries)
  if (stableJson(missing) !== stableJson(request.createdDirectories)) {
    throw new Error('Mutation created directories do not match the exact missing add ancestors')
  }
}

async function assertExistingAddParent(
  target: string,
  path: string,
  requireOwned = false,
): Promise<void> {
  let current = dirname(path).split(sep).join('/')
  while (current !== '.' && !(await pathExists(safeTargetPath(target, current)))) {
    current = dirname(current).split(sep).join('/')
  }
  if (current === '.') {
    if (requireOwned) await assertOwnedWriteAncestors(target, 'sentinel')
    return
  }
  await assertSafeAncestors(target, `${current}/sentinel`)
  await assertDirectory(safeTargetPath(target, current), current)
  if (requireOwned) await assertOwnedWriteAncestors(target, `${current}/sentinel`)
}

async function cleanupCreatedDirectories(
  target: string,
  directories: readonly string[],
): Promise<void> {
  for (const directory of [...directories].sort(
    (left, right) => right.split('/').length - left.split('/').length,
  )) {
    const path = safeTargetPath(target, directory)
    try {
      await assertOwnedWriteAncestors(target, `${directory}/sentinel`)
      await rmdir(path)
      await syncDirectory(dirname(path))
    } catch (error) {
      if (
        !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')
      ) {
        throw error
      }
    }
  }
}

async function assertNoJournal(target: string): Promise<void> {
  for (const path of [journalRelativePath, updateJournalRelativePath]) {
    try {
      await access(safeTargetPath(target, path))
      throw new Error(`Pending journal requires recovery before mutation planning: ${path}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

function orderLockLast<T extends { path: string }>(entries: readonly T[], lockPath: string): T[] {
  return [...entries].sort((left, right) => {
    if (left.path === lockPath) return 1
    if (right.path === lockPath) return -1
    return left.path.localeCompare(right.path)
  })
}

function assertMode(mode: number | undefined, label: string): asserts mode is number {
  if (!Number.isInteger(mode) || mode! < 0 || mode! > 0o777) throw new Error(`${label} is invalid`)
}

function compareDirectories(left: string, right: string): number {
  const depth = left.split('/').length - right.split('/').length
  return depth || left.localeCompare(right)
}

function portablePathEqual(left: string, right: string): boolean {
  return portablePathKey(left) === portablePathKey(right)
}

function portablePathKey(path: string): string {
  return path.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC')
}

function assertPortableMutationPath(path: string, label: string): void {
  const result = scaffoldPathSchema.safeParse(path)
  if (!result.success) throw new Error(`${label} must be a portable normalized path: ${path}`)
  safeTargetPath('/mutation-root', path)
}

export function parseMutationJournalV2(value: unknown): MutationJournalV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid mutation journal v2')
  const journal = value as MutationJournalV2
  if (
    !hasExactKeys(journal as unknown as Record<string, unknown>, [
      'schemaVersion',
      'operationId',
      'operationKind',
      'backupRoot',
      'status',
      'createdDirectories',
      'entries',
    ]) ||
    journal.schemaVersion !== 2 ||
    !uuidPattern.test(journal.operationId) ||
    !['update', 'generate'].includes(journal.operationKind) ||
    journal.backupRoot !== `.cornerstone/mutation-backup-${journal.operationId}` ||
    !['preparing', 'pending', 'committed', 'rolled-back'].includes(journal.status) ||
    !Array.isArray(journal.createdDirectories) ||
    !Array.isArray(journal.entries) ||
    journal.entries.length === 0
  )
    throw new Error('Invalid mutation journal v2')
  const createdDirectories: string[] = []
  for (const directory of journal.createdDirectories) {
    if (
      typeof directory !== 'string' ||
      isGeneratorControlPath(directory) ||
      createdDirectories.some((candidate) => portablePathEqual(candidate, directory))
    ) {
      throw new Error('Invalid mutation journal v2 created directory')
    }
    assertPortableMutationPath(directory, 'Mutation journal created directory')
    createdDirectories.push(directory)
  }
  if (
    stableJson(journal.createdDirectories) !==
    stableJson([...createdDirectories].sort(compareDirectories))
  )
    throw new Error('Invalid mutation journal v2 created directory order')
  const paths: string[] = []
  for (const entry of journal.entries) {
    if (
      !entry ||
      !hasExactKeys(entry as unknown as Record<string, unknown>, [
        'action',
        'path',
        'backupPath',
        'beforeChecksum',
        'beforeMode',
        'afterChecksum',
        'afterMode',
      ]) ||
      !['add', 'modify', 'delete'].includes(entry.action) ||
      typeof entry.path !== 'string'
    )
      throw new Error('Invalid mutation journal v2 entry')
    assertPortableMutationPath(entry.path, 'Mutation journal path')
    if (paths.some((path) => portableScaffoldPathsConflict(path, entry.path)))
      throw new Error('Invalid colliding mutation journal v2 path')
    if (entry.path !== lockRelativePath && isGeneratorControlPath(entry.path))
      throw new Error('Invalid mutation journal v2 control path')
    paths.push(entry.path)
    const beforeRequired = entry.action !== 'add'
    const afterRequired = entry.action !== 'delete'
    if (
      entry.backupPath !== (beforeRequired ? `${journal.backupRoot}/${entry.path}` : null) ||
      (beforeRequired
        ? !digestPattern.test(entry.beforeChecksum ?? '')
        : entry.beforeChecksum !== null) ||
      (beforeRequired ? !validMode(entry.beforeMode) : entry.beforeMode !== null) ||
      (afterRequired
        ? !digestPattern.test(entry.afterChecksum ?? '')
        : entry.afterChecksum !== null) ||
      (afterRequired ? !validMode(entry.afterMode) : entry.afterMode !== null)
    )
      throw new Error('Invalid mutation journal v2 entry')
  }
  const lockEntries = journal.entries.filter(({ path }) => path === lockRelativePath)
  if (lockEntries.length !== 1 || lockEntries[0]!.action !== 'modify') {
    throw new Error('Invalid mutation journal v2 manifest lock entry')
  }
  const addPaths = journal.entries.filter(({ action }) => action === 'add').map(({ path }) => path)
  for (const directory of journal.createdDirectories) {
    if (!addPaths.some((path) => path.startsWith(`${directory}/`))) {
      throw new Error('Invalid mutation journal v2 created directory binding')
    }
  }
  return journal
}

function validMode(mode: number | null): boolean {
  return Number.isInteger(mode) && mode! >= 0 && mode! <= 0o777
}
