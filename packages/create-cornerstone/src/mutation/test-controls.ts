type UpdateFailurePoint =
  | 'before-backup'
  | 'after-output'
  | 'after-commit-before-cleanup'
  | 'before-temp-rename'
  | 'after-rollback-before-cleanup'
  | 'after-rollback-backup-cleanup'
  | 'before-operation-lock-cleanup'
  | 'mutation-after-write'
  | 'mutation-after-output'
  | 'mutation-before-rollback'
  | 'mutation-crash-after-journal'
  | 'mutation-crash-after-output'
  | 'mutation-crash-after-commit'
  | 'mutation-crash-after-rollback'

let injectedFailure: UpdateFailurePoint | undefined
let updateHook: ((point: UpdateFailurePoint, path?: string) => void | Promise<void>) | undefined

export function injectUpdateFailureForTest(point: UpdateFailurePoint | undefined): void {
  injectedFailure = point
}

export function failUpdateIfInjected(point: UpdateFailurePoint): void {
  if (injectedFailure !== point) return
  injectedFailure = undefined
  throw new Error(`Injected update failure: ${point}`)
}

class InjectedMutationCrash extends Error {}

export function failMutationCrashIfInjected(point: UpdateFailurePoint): void {
  if (injectedFailure !== point) return
  injectedFailure = undefined
  throw new InjectedMutationCrash(`Injected mutation crash: ${point}`)
}

export function isInjectedMutationCrash(error: unknown): boolean {
  return error instanceof InjectedMutationCrash
}

export function setUpdateHookForTest(
  hook: ((point: UpdateFailurePoint, path?: string) => void | Promise<void>) | undefined,
): void {
  updateHook = hook
}

export async function runUpdateHookForTest(
  point: UpdateFailurePoint,
  path?: string,
): Promise<void> {
  await updateHook?.(point, path)
}

export function isTrustedUpdateParentPolicy(input: {
  childUserId: number
  effectiveUserId: number
  parentMode: number
  parentUserId: number
}): boolean {
  if (input.parentUserId !== 0 && input.parentUserId !== input.effectiveUserId) return false
  if ((input.parentMode & 0o022) === 0) return true
  return (input.parentMode & 0o1000) !== 0 && input.childUserId === input.effectiveUserId
}
