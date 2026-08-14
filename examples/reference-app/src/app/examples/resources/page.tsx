import {
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  Pagination,
  Toolbar,
} from '@cornerstone/ui'
import { FixtureAnnotation, fixtureState, type FixtureState } from '../../fixture'
import { ReferenceShell } from '../../reference-shell'

const states = ['loading', 'ready', 'empty', 'error'] as const satisfies readonly FixtureState[]
const resources = [
  { id: 'guide', name: '시작 가이드', owner: 'Platform', updated: '2026-08-14' },
  { id: 'tokens', name: '토큰 카탈로그', owner: 'Design', updated: '2026-08-13' },
] as const
const columns = [
  {
    id: 'name',
    label: '이름',
    header: '이름',
    cell: (resource: (typeof resources)[number]) => resource.name,
    sortable: true,
    priority: 'primary' as const,
  },
  {
    id: 'owner',
    label: '소유자',
    header: '소유자',
    cell: (resource: (typeof resources)[number]) => resource.owner,
    priority: 'secondary' as const,
  },
  {
    id: 'updated',
    label: '업데이트',
    header: '업데이트',
    cell: (resource: (typeof resources)[number]) => resource.updated,
    priority: 'tertiary' as const,
  },
]

export default async function ResourcesPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ state?: string }>
}) {
  const state = fixtureState((await searchParams).state, states)
  return (
    <ReferenceShell currentPath="/examples/resources">
      <PageShell>
        <FixtureAnnotation
          route="/examples/resources"
          state={state}
          states={states}
          automaticId="resources.chromium"
        >
          <PageHeader
            title="리소스"
            description="DataTable의 명시적 cards 반응형 정책 fixture입니다."
          />
          <Toolbar label="리소스 도구 모음">
            <span>모든 리소스</span>
          </Toolbar>
          <DataTable
            caption="리소스 목록"
            columns={columns}
            rows={state === 'ready' ? resources : []}
            getRowId={(resource) => resource.id}
            responsiveMode="cards"
            loading={state === 'loading'}
            emptyState={
              <EmptyState title="리소스가 없습니다" description="표시할 fixture 항목이 없습니다." />
            }
            error={
              state === 'error' ? (
                <ErrorState
                  title="리소스를 불러올 수 없습니다"
                  description="재시도할 수 있는 오류 fixture입니다."
                />
              ) : undefined
            }
          />
          {state === 'ready' ? (
            <Pagination
              page={1}
              pageCount={3}
              getPageHref={(page) => `/examples/resources?page=${page}`}
            />
          ) : null}
        </FixtureAnnotation>
      </PageShell>
    </ReferenceShell>
  )
}
