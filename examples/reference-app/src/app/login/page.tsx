import { Alert, Button, FormField, Heading, Input, PageShell, Stack } from '@cornerstone/ui'
import { FixtureAnnotation, fixtureState, type FixtureState } from '../fixture'

const states = ['ready', 'invalid', 'loading', 'error'] as const satisfies readonly FixtureState[]

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ state?: string }>
}) {
  const state = fixtureState((await searchParams).state, states)
  return (
    <main>
      <PageShell size="sm">
        <FixtureAnnotation
          route="/login"
          state={state}
          states={states}
          automaticId="login.chromium"
        >
          <Heading as="h1">로그인</Heading>
          {state === 'error' ? (
            <Alert tone="danger" title="로그인할 수 없습니다">
              다시 시도해 주세요.
            </Alert>
          ) : null}
          <form aria-label="로그인 fixture">
            <Stack gap="4">
              <FormField
                label="이메일"
                required
                error={state === 'invalid' ? '유효한 이메일을 입력하세요.' : undefined}
              >
                {(props) => (
                  <Input
                    {...props}
                    type="email"
                    defaultValue="fixture@example.com"
                    disabled={state === 'loading'}
                  />
                )}
              </FormField>
              <FormField label="비밀번호" required>
                {(props) => <Input {...props} type="password" disabled={state === 'loading'} />}
              </FormField>
              <Button type="submit" loading={state === 'loading'} disabled={state === 'loading'}>
                계속
              </Button>
            </Stack>
          </form>
        </FixtureAnnotation>
      </PageShell>
    </main>
  )
}
