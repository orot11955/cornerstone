'use client'

interface ErrorRecoveryProps {
  readonly reset: () => void
}

export default function ErrorRecovery({ reset }: ErrorRecoveryProps) {
  return (
    <main>
      <h1>UI Foundation segment error</h1>
      <button type="button" onClick={reset}>
        다시 시도
      </button>
    </main>
  )
}
