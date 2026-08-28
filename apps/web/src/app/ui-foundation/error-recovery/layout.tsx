import type { ReactNode } from 'react'
import { ErrorRecoveryFixtureProvider } from './error-recovery-context'

interface ErrorRecoveryFixtureLayoutProps {
  readonly children: ReactNode
}

export default function ErrorRecoveryFixtureLayout({
  children,
}: ErrorRecoveryFixtureLayoutProps) {
  return <ErrorRecoveryFixtureProvider>{children}</ErrorRecoveryFixtureProvider>
}
