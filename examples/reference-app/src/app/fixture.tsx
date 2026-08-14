import type { ReactNode } from 'react'
import { Link, Stack, Text, Toolbar } from '@cornerstone/ui'

export type FixtureState =
  'ready' | 'invalid' | 'loading' | 'error' | 'dirty' | 'saving' | 'saved' | 'empty'

interface FixtureAnnotationProps {
  readonly route: string
  readonly state: FixtureState
  readonly automaticId: string
  readonly states: readonly FixtureState[]
  readonly children: ReactNode
}

export function FixtureAnnotation({
  route,
  state,
  automaticId,
  states,
  children,
}: FixtureAnnotationProps) {
  return (
    <div data-fixture-route={route} data-fixture-state={state} data-acceptance-id={automaticId}>
      <Toolbar label={`${route} fixture state`}>
        <Text size="sm" tone="muted">
          Fixture state
        </Text>
        {states.map((candidate) => (
          <Link
            key={candidate}
            href={`${route}?state=${candidate}`}
            variant="ghost"
            current={candidate === state}
          >
            {candidate}
          </Link>
        ))}
      </Toolbar>
      <Stack gap="5">{children}</Stack>
    </div>
  )
}

export function fixtureState(
  value: string | string[] | undefined,
  allowed: readonly FixtureState[],
  fallback: FixtureState = 'ready',
): FixtureState {
  return typeof value === 'string' && allowed.includes(value as FixtureState)
    ? (value as FixtureState)
    : fallback
}
