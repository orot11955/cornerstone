'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type ErrorRecoveryPhase = 'idle' | 'throwing' | 'recovered'

interface ErrorRecoveryFixtureContextValue {
  readonly phase: ErrorRecoveryPhase
  readonly trigger: () => void
  readonly recover: () => void
}

const ErrorRecoveryFixtureContext = createContext<ErrorRecoveryFixtureContextValue | null>(null)

interface ErrorRecoveryFixtureProviderProps {
  readonly children: ReactNode
}

export function ErrorRecoveryFixtureProvider({
  children,
}: ErrorRecoveryFixtureProviderProps) {
  const [phase, setPhase] = useState<ErrorRecoveryPhase>('idle')
  const trigger = useCallback(() => setPhase('throwing'), [])
  const recover = useCallback(() => setPhase('recovered'), [])
  const value = useMemo(
    () => ({ phase, trigger, recover }),
    [phase, trigger, recover],
  )

  return (
    <ErrorRecoveryFixtureContext.Provider value={value}>
      {children}
    </ErrorRecoveryFixtureContext.Provider>
  )
}

export function useErrorRecoveryFixture(): ErrorRecoveryFixtureContextValue {
  const value = useContext(ErrorRecoveryFixtureContext)
  if (!value) throw new Error('ErrorRecoveryFixtureProvider is required')
  return value
}
