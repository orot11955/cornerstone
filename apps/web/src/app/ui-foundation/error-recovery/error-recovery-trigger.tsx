'use client'

import { useErrorRecoveryFixture } from './error-recovery-context'

export function ErrorRecoveryTrigger() {
  const { phase, trigger } = useErrorRecoveryFixture()

  if (phase === 'throwing') throw new Error('UI foundation error recovery fixture')
  if (phase === 'recovered') return <p data-testid="error-recovered">복구 완료</p>

  return (
    <button type="button" onClick={trigger}>
      오류 발생
    </button>
  )
}
