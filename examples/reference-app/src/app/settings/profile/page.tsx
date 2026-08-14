import {
  Alert,
  Button,
  FormField,
  Input,
  PageHeader,
  PageShell,
  Select,
  Stack,
} from '@cornerstone/ui'
import { FixtureAnnotation, fixtureState, type FixtureState } from '../../fixture'
import { ReferenceShell } from '../../reference-shell'

const states = [
  'ready',
  'dirty',
  'saving',
  'saved',
  'error',
] as const satisfies readonly FixtureState[]

export default async function ProfilePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ state?: string }>
}) {
  const state = fixtureState((await searchParams).state, states)
  return (
    <ReferenceShell currentPath="/settings/profile">
      <PageShell size="md">
        <FixtureAnnotation
          route="/settings/profile"
          state={state}
          states={states}
          automaticId="profile.chromium"
        >
          <PageHeader title="프로필 설정" description="로컬 fixture 상태로만 표현됩니다." />
          {state === 'saved' ? (
            <Alert tone="success" title="저장됨">
              변경사항이 반영되었습니다.
            </Alert>
          ) : null}
          {state === 'error' ? (
            <Alert tone="danger" title="저장 실패">
              네트워크 요청 없이 재현한 오류 상태입니다.
            </Alert>
          ) : null}
          <form aria-label="프로필 fixture">
            <Stack gap="4">
              <FormField label="표시 이름" required>
                {(props) => (
                  <Input
                    {...props}
                    defaultValue="Cornerstone 사용자"
                    disabled={state === 'saving'}
                  />
                )}
              </FormField>
              <FormField label="지역">
                {(props) => (
                  <Select {...props} defaultValue="ko-KR" disabled={state === 'saving'}>
                    <option value="ko-KR">한국어</option>
                    <option value="en-US">English</option>
                  </Select>
                )}
              </FormField>
              <Button type="submit" loading={state === 'saving'} disabled={state === 'saving'}>
                {state === 'dirty' ? '변경사항 저장' : '저장'}
              </Button>
            </Stack>
          </form>
        </FixtureAnnotation>
      </PageShell>
    </ReferenceShell>
  )
}
