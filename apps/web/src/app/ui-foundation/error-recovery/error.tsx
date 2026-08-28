'use client'

import { useErrorRecoveryFixture } from './error-recovery-context'

interface ErrorRecoveryProps {
  readonly reset: () => void
}

export default function ErrorRecovery({ reset }: ErrorRecoveryProps) {
  const { recover } = useErrorRecoveryFixture()

  const handleRetry = () => {
    recover()
    reset()
  }

  return (
    <main>
      <h1>UI Foundation segment error</h1>
      <button type="button" onClick={handleRetry}>
        다시 시도
      </button>
    </main>
  )
}
