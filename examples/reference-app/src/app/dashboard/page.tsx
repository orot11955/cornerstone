import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  Progress,
  Skeleton,
  Stack,
  Status,
} from '@cornerstone/ui'
import { FixtureAnnotation, fixtureState, type FixtureState } from '../fixture'
import { InteractionShowcase } from '../interaction-showcase'
import { ReferenceShell } from '../reference-shell'

const states = ['loading', 'ready', 'empty', 'error'] as const satisfies readonly FixtureState[]
const activity = [{ id: 'deploy', name: 'Reference release', status: '완료' }] as const
const columns = [
  {
    id: 'name',
    label: '작업',
    header: '작업',
    cell: (item: (typeof activity)[number]) => item.name,
    priority: 'primary' as const,
  },
  {
    id: 'status',
    label: '상태',
    header: '상태',
    cell: (item: (typeof activity)[number]) => item.status,
    priority: 'secondary' as const,
  },
]

export default async function DashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ state?: string }>
}) {
  const state = fixtureState((await searchParams).state, states)
  return (
    <ReferenceShell currentPath="/dashboard">
      <PageShell>
        <FixtureAnnotation
          route="/dashboard"
          state={state}
          states={states}
          automaticId="dashboard.chromium"
        >
          <PageHeader title="대시보드" description="모든 값은 고정 fixture 데이터입니다." />
          {state === 'loading' ? (
            <Skeleton width="100%" height="10rem" shape="rectangle" label="대시보드 불러오는 중" />
          ) : null}
          {state === 'error' ? (
            <ErrorState
              title="대시보드를 불러올 수 없습니다"
              description="결정적인 오류 fixture입니다."
            />
          ) : null}
          {state === 'empty' ? (
            <EmptyState
              title="표시할 활동이 없습니다"
              description="결정적인 빈 상태 fixture입니다."
            />
          ) : null}
          {state === 'ready' ? (
            <Stack gap="5">
              <Card header={<Status tone="success" label="운영 정상" />}>
                <Progress value={72} label="이번 주 사용량" />
              </Card>
              <DataTable
                caption="최근 활동"
                columns={columns}
                rows={activity}
                getRowId={(item) => item.id}
                responsiveMode="columns"
              />
              <InteractionShowcase />
            </Stack>
          ) : null}
        </FixtureAnnotation>
      </PageShell>
    </ReferenceShell>
  )
}
