# Cornerstone 아키텍처와 설계 원칙

> 이 문서는 Cornerstone의 영속적인 설계 계약을 정의한다. 구현 순서와 현재 상태는
> [`cornerstone_implementation_plan.md`](./cornerstone_implementation_plan.md)를 따른다.

## 1. 목적

Cornerstone은 새 TypeScript 풀스택 프로젝트마다 반복되는 기반을 공통 패키지와 프로젝트 템플릿으로 제공하는 Starter Kit이다. 특정 제품의 Boilerplate가 아니라, 프로젝트가 필요한 기능과 디자인을 조합할 수 있는 기반 플랫폼을 지향한다.

```text
공통 기반 → Frontend → Backend → 인증/권한 → 데이터 → API
         → 관측/운영 → 테스트 → CI/CD → 개발 생산성
```

핵심 원칙은 다음과 같다.

- 반복 코드를 복사하지 않고 `packages/*`의 공통 계약과 Starter template으로 재사용한다.
- 앱과 패키지는 공개 API를 통해 결합하며 내부 구현에 의존하지 않는다.
- 프로젝트별 업무 Domain은 Starter에 포함하지 않는다.
- 일반적인 제품 화면에 반복되는 UI는 Starter의 표준 범위로 선제 제공한다.
- 표준 범위 밖의 신규 추상화는 두 개 이상의 실제 프로젝트에서 반복된 뒤 공통 기반으로 승격한다.
- 보안, 데이터 무결성, 관측 가능성과 배포 복구 절차를 초기 구조에 포함한다.

## 2. 제품 경계

### Core

- pnpm Workspace와 Turborepo 기반 Monorepo
- Next.js Web과 NestJS API
- 공통 TypeScript, lint, format 설정
- 환경 변수 검증, 표준 오류, 요청 추적과 구조화 로그
- PostgreSQL, TypeORM, Migration과 Seed 규칙
- User, Session, Cookie 인증과 Role 기반 인가의 기본 경계
- API client, query, form과 포괄적인 공통 UI Kit
- 디자인 토큰과 Appearance preset
- Unit, Integration, E2E, CI와 Production image의 기본 계약

### Optional

- Redis, Queue, Scheduler, WebSocket, SSE
- OAuth, 2FA, 메일, Object Storage
- 특정 Cloud 또는 배포 플랫폼 adapter
- 조직·Tenant 기반의 복합 Permission

### Starter에서 제외

- 프로젝트별 업무 Entity, 화면, API와 Domain token
- 표준 UI 범위 밖에서 검증된 사용 사례가 없는 범용 추상화
- 특정 Brand 또는 Style에 종속된 컴포넌트 계약

## 3. 시스템 구조

```text
cornerstone/
├─ apps/
│  ├─ web/                 Next.js UI와 사용자 흐름
│  └─ api/                 NestJS API와 서버 정책
├─ packages/
│  ├─ api-client/          HTTP 계약과 오류 변환
│  ├─ config/              공유 가능한 설정 schema와 상수
│  ├─ eslint-config/       공통 정적 분석 설정
│  ├─ schemas/             런타임 입력 검증
│  ├─ tsconfig/            실행 환경별 TypeScript 설정
│  ├─ types/               직렬화 가능한 공통 타입
│  ├─ ui/                  토큰과 포괄적인 Domain 독립 UI Kit
│  └─ utils/               환경 독립 pure utility
├─ infra/                  로컬·운영 인프라 정의
├─ e2e/                    사용자 핵심 경로 검증
├─ docs/                   설계, 계획과 운영 기록
└─ scripts/                반복 가능한 관리 작업
```

허용 의존 방향은 다음과 같다.

```text
apps/web ─┬─> api-client ─> schemas/types
          └─> ui ─────────> types/utils

apps/api ────────────────> schemas/types/utils/config

low-level packages -X-> apps
packages/ui       -X-> API 또는 프로젝트 Domain
```

순환 의존, Entity의 API 노출, 앱 내부 경로를 향한 package 의존은 허용하지 않는다.

### 3.1 공통 패키지 책임

공통 코드를 한 패키지에 모으지 않고 런타임과 책임에 따라 분리한다.

| Package      | 소유 책임                                                   | 포함하지 않는 것                                  |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------- |
| `types`      | 직렬화 가능한 공통 wire·structural type                     | runtime 검증, Entity, React/browser type          |
| `schemas`    | 외부 입력의 runtime 검증과 추론 type                        | transport, UI, Domain allowlist                   |
| `config`     | 환경 독립 설정 계약·기본값·조합                             | secret, 앱별 env 읽기, 전역 `process.env` 접근    |
| `utils`      | 환경 독립적이고 결정적이며 부작용 없는 함수                 | DOM hook, HTTP·보안 정책, Domain 규칙             |
| `api-client` | HTTP, 직렬화, 취소, 오류 envelope 변환                      | Query cache, Toast, Router, React hook, 권한 판단 |
| `ui`         | token, component, layout, 접근성 behavior와 UI browser hook | API 호출, Auth·Domain 정책                        |
| `apps/web`   | Route, Domain 조합, Query/Auth 상태와 endpoint hook         | 공통 Primitive 재구현                             |

`utils`는 다음 범위를 우선한다.

```text
string       blank 검사, 공백 정규화, 안전한 말줄임
number       clamp, 범위 제한, 명시적 자리수 반올림
date/time    유효성, ISO 변환, 명시적 timezone 계산
collection   unique/group/chunk 등 native로 충분하지 않은 순수 변환
url/query    URL·URLSearchParams 기반 parse, merge, serialize
async        AbortSignal을 존중하는 timeout과 제한된 동시성 보조
result       Result<T, E>, ok, err와 명시적 오류 변환
```

공통 유틸 원칙:

- `Array`, `Object`, `URL`, `URLSearchParams`, `Intl`, `AbortController`, `structuredClone` 등 표준 API를 우선한다.
- 입력을 mutation하지 않고 오류를 삼키거나 의미를 숨긴 fallback을 반환하지 않는다.
- locale, timezone, currency가 필요한 formatter는 값을 인자로 요구한다.
- Cookie/JWT/password, 암복호화, HTML sanitization, redirect allowlist 같은 보안 정책은 범용 `utils`에 두지 않는다.
- Permission, 가격 정책, endpoint sort allowlist 같은 Domain 규칙을 포함하지 않는다.
- HTTP retry, 인증 갱신과 transport 오류는 `api-client`가 소유한다.
- DOM, storage, clipboard, focus, scroll와 resize 관찰은 `@cornerstone/ui/browser` 같은 명시적 browser subpath가 소유한다.
- browser module도 import 시 `window`나 `document`를 읽지 않으며 SSR 초기 상태와 hydration 동작을 정의한다.

Package root와 승인된 subpath만 공개하고 `src/*` deep import를 금지한다. Named export, side-effect 없는 module과 `export type`을 사용하며 browser-only dependency가 server entry로 유입되지 않게 한다. CSS side effect 전략이 확정되기 전에는 무조건 `sideEffects: false`를 선언하지 않는다.

### 3.2 API 계약의 단일 원천

- Endpoint request/response와 오류 계약은 Nest DTO에서 생성한 versioned OpenAPI를 기준으로 한다.
- `schemas`는 email, UUID, pagination 문법처럼 transport-independent primitive를 제공하며 endpoint DTO를 복제하지 않는다.
- API client type과 endpoint adapter는 OpenAPI에서 생성하거나, ADR에서 지정한 단일 소유자가 snapshot과 contract test로 동기화한다.
- Entity, ORM enum과 `Date` 객체를 wire contract로 노출하지 않는다.
- OpenAPI snapshot에는 breaking-change diff를 적용하고 `204`, `401`, `403`, `409`, pagination, error envelope와 날짜/ID 직렬화 의미를 고정한다.

### 3.3 Starter 배포 모델

Cornerstone은 저장소 복제본 하나가 아니라 버전이 있는 공통 패키지와 프로젝트 템플릿의 조합으로 배포한다.

```text
@cornerstone/* packages       버전이 있는 재사용 계약과 구현
Project template              apps, infra, root config와 시작 문서
Compatibility manifest       package/template/runtime/schema 기준
Migration guide              복사된 파일의 수동 업그레이드 절차
```

- Starter v1은 공통 패키지를 같은 버전으로 묶는 synchronized release를 기본으로 한다.
- Template은 정확한 package 버전, 지원 Node/pnpm 범위와 DB schema baseline을 기록한다.
- 공통 수정은 package update로 전달하고 생성된 프로젝트의 앱·인프라 파일을 자동 덮어쓰지 않는다.
- 공개 package는 workspace link가 없는 임시 소비자에서 tarball 설치, typecheck와 build를 검증한다.
- Template release는 빈 디렉터리에서 생성, 설치, Migration, 핵심 E2E와 production image 실행까지 검증한다.
- 직전 Template에 대표 사용자 변경을 적용한 fixture에서 package update와 migration guide를 각각 리허설하고 사용자 소유 파일을 보존한다.
- Registry와 배포 provider가 정해지기 전에도 local tarball과 versioned template archive로 같은 계약을 검증한다.

### 3.4 호환성 정책

| 계약           | 변경 원칙                                                  |
| -------------- | ---------------------------------------------------------- |
| Package export | SemVer, additive 우선, 제거는 major와 migration guide      |
| REST API       | additive 우선, 제거·의미 변경은 versioning과 consumer 전환 |
| Environment    | rename 시 호환 alias와 deprecation 기간 제공               |
| Database       | N/N-1 앱 read/write 호환과 expand/backfill/contract        |
| Cookie/Session | key overlap, TTL과 명시적인 강제 로그아웃 조건             |
| UI token/prop  | `@deprecated`, 대체 API와 호환 adapter 제공                |
| Template       | 자동 overwrite 금지, release별 수동 migration guide 제공   |

공개 계약, 환경 변수, Migration, OpenAPI와 generated artifact는 변경 소유자를 하나만 둔다. Breaking change는 영향 소비자, 전환 순서, rollback 또는 roll-forward와 지원 종료 시점을 기록한다.

## 4. 애플리케이션 경계

### Frontend

- Server/Client 경계를 명시하고 요청 간 인증 및 Query 상태를 공유하지 않는다.
- API 접근은 `api-client`로 모으고 화면 컴포넌트가 transport 세부사항에 의존하지 않게 한다.
- Client validation은 UX를 위한 1차 검증이며 서버 검증을 최종 기준으로 한다.
- Route 보호와 별개로 API가 항상 인증과 권한을 검증한다.

### Backend와 API

- `Controller → Service → Repository` 책임을 유지한다.
- DTO와 Mapper로 API 계약을 Entity에서 분리한다.
- OpenAPI를 서버 계약의 기준으로 삼고 날짜는 ISO 8601 UTC 문자열로 직렬화한다.
- 오류 응답은 안정적인 code, 안전한 message, request ID를 제공한다.
- 입력값, CORS origin, Cookie, CSRF와 권한을 명시적으로 검증한다.

### Data

- `synchronize=false`를 유지하고 모든 schema 변경은 검토 가능한 Migration으로 적용한다.
- 배포는 `expand → migrate/backfill → contract` 호환 순서를 기본으로 한다.
- 빈 DB뿐 아니라 지원하는 직전 release의 schema/data와 구·신 앱 조합에서 Migration과 read/write 호환을 검증한다.
- 개발, 테스트와 운영 DB를 분리한다.
- Seed는 멱등이고 운영에서 자동 실행하지 않으며 비밀정보를 포함하지 않는다.

### Operations

- liveness와 readiness를 분리하고 필수 dependency만 readiness에 포함한다.
- 로그에는 token, password, Cookie 원문과 불필요한 개인정보를 남기지 않는다.
- 구조화 로그, metric과 trace/correlation context로 요청에서 DB 오류까지 연결한다.
- 앱 replica 시작과 Migration 실행을 분리한다.
- Build artifact는 한 번 만들고 검증한 동일 digest를 환경 간 승격한다.
- Runtime, Migration과 배포 principal을 분리하고 최소 권한을 적용한다.
- 변경마다 검증, 배포 순서와 rollback 가능성을 기록한다.

## 5. 디자인 시스템 계약

Cornerstone은 하나의 고정 디자인을 제공하지 않는다. 재사용 가능한 Foundation과 컴포넌트 계약, 그리고 교체 가능한 Appearance preset을 제공한다.

### 5.1 계층과 의존 방향

```text
Foundations / Primitive
├─ color
├─ typography
├─ spacing
├─ radius
├─ shadow
├─ motion
└─ breakpoint
        │
        ▼
Semantic Tokens
├─ background
├─ text
├─ border
├─ status
└─ data
        │
        ▼
Component Tokens
├─ button
├─ input
├─ panel
├─ table
└─ ...
        │
        ▼
Components
        │
        ▼
Domain Tokens          프로젝트별 확장
```

- Primitive는 원시 값이며 컴포넌트가 직접 사용하지 않는다.
- Semantic token은 의미를 표현하고 Appearance가 선택한 값을 받는다.
- Component token은 semantic token만 조합한다.
- 공통 컴포넌트는 component token만 사용하고 Theme, Style, Brand의 원시 값을 직접 참조하지 않는다.
- Domain token은 Starter 밖에서 확장하며 공통 package로 역류하지 않는다.

### 5.2 Appearance

Appearance는 토큰 계층이 아니라 Semantic token에 값을 공급하는 서로 독립적인 네 축이다.

| 축      | 책임                         | 기본 지원 값                                   |
| ------- | ---------------------------- | ---------------------------------------------- |
| Theme   | 명도와 환경 선호             | `light`, `dark`                                |
| Style   | 형태, 표면, 대비와 시각 문법 | `industrial`, `minimal`, `soft`                |
| Brand   | 상호작용과 선택의 정체성 색  | `signal-violet`, `orange`, `emerald`, `custom` |
| Density | 공간과 컨트롤 크기           | `compact`, `default`, `comfortable`            |

DOM에는 해석된 값을 선언한다.

```html
<html data-theme="dark" data-style="industrial" data-brand="signal-violet" data-density="default">
  <!-- application -->
</html>
```

사용자 설정의 Theme preference는 `system | light | dark`가 될 수 있지만, DOM의 resolved Theme은 `light | dark`만 사용한다. Cornerstone 권장 초기 preference/preset은 다음과 같다.

```text
Theme preference : system
Style            : minimal
Brand            : signal-violet
Density          : default
```

이는 변경 가능한 Starter 초기값이며 특정 조합을 “Cornerstone 디자인”으로 고정하지 않는다. 지원 조합은 각 Theme에서 대비와 상태 구분을 검증해야 하며, 잘못된 저장값은 위 초기값으로 복구한다.

Brand는 success, warning, danger 같은 Status 의미를 대신하지 않는다. Density는 정보량만 조정하며 기능이나 정보 우선순위를 바꾸지 않는다. Component variant는 Appearance와 별개의 공개 API다.

### 5.3 ATLAS 레퍼런스

[`atlas-industrial-violet.html`](./atlas-industrial-violet.html)은 다음 조합을 보여주는 비규범적 시각 레퍼런스다.

```text
Theme   : dark
Style   : industrial
Brand   : signal-violet
Density : default
```

ATLAS는 Cornerstone의 default theme이나 토큰 구현 원본이 아니다. 독립 실행을 위해 포함된 직접 색상, Domain color와 inline 구현은 `packages/ui`의 공용 계약으로 복사하지 않는다.

### 5.4 Responsive와 Layout Token

Responsive는 사용 가능한 공간에 따른 배치 변화이고 Density는 같은 정보와 기능을 유지한 채 간격·행 높이·control 크기를 조정하는 Appearance preference다. 작은 viewport에서 Density를 자동 변경하거나 Density로 정보와 action을 숨기지 않는다.

```text
Primitive
├─ viewport breakpoint: sm / md / lg / xl
├─ container threshold: compact / regular / wide
├─ spacing / size / measure
└─ safe area

Semantic Layout
├─ layout.content.*
├─ layout.gutter.*
├─ layout.page-gap.*
├─ layout.shell.*
└─ layout.safe-area.*

Component Layout
└─ app-shell / page-shell / toolbar / table / dialog / ...
```

- breakpoint는 기기명이 아니라 콘텐츠가 깨지는 공간을 `rem` 단위로 표현한다.
- CSS와 TypeScript는 같은 token 원천에서 viewport breakpoint와 container threshold를 생성한다.
- `AppShell`, `PageShell` 같은 페이지 구조는 viewport query를 사용한다.
- 재사용 Card, Toolbar, Table과 Form block은 container query를 우선한다.
- CSS로 가능한 배치는 JS viewport 측정으로 결정하지 않으며 SSR과 hydration의 DOM 구조를 유지한다.
- JS 측정은 chart canvas, virtualized viewport처럼 CSS로 해결할 수 없는 enhancement에만 사용한다.

공개 responsive 값은 layout 관련 prop의 선별된 집합에만 허용한다.

```ts
type Breakpoint = 'sm' | 'md' | 'lg' | 'xl'

type Responsive<T> = T | ({ base: T } & Partial<Record<Breakpoint, T>>)
```

```tsx
<Stack direction={{ base: 'column', lg: 'row' }} gap={{ base: '3', md: '5' }} />
```

`tone`, `loading`, `disabled`, `selected`처럼 의미·동작·접근성을 바꾸는 prop은 responsive하게 만들지 않는다. 물리 방향인 `left/right`보다 논리 방향인 `inline/block`, `start/end`를 사용해 RTL을 보존한다.

## 6. 범용 UI Kit

`packages/ui`의 목표는 몇 개의 Primitive를 제공하는 것이 아니다. 인증, 설정, 관리도구, Dashboard, CRUD와 데이터 중심 화면의 대부분을 프로젝트별 재구현 없이 조립할 수 있는 컴포넌트 체계를 제공한다.

모든 컴포넌트는 동일한 semantic/component token, Appearance, 상태 표현, 접근성과 interaction 규칙을 사용한다. 프로젝트 앱은 공통 컴포넌트를 조합하고 Domain 데이터와 행동만 연결한다.

### 6.1 컴포넌트 범위

```text
Foundation / Utility
Icon, Typography, Separator, AspectRatio, VisuallyHidden,
ScrollArea, Portal, FocusTrap

Action
Button, IconButton, ButtonGroup, Toggle, ToggleGroup,
SplitButton, CopyButton

Form
Input, Textarea, NumberInput, PasswordInput, SearchInput,
Select, MultiSelect, Combobox, Autocomplete, Checkbox, Radio,
Switch, Slider, DatePicker, DateRangePicker, TimePicker,
FileUpload, FormField, Fieldset

Navigation
Link, Breadcrumb, Tabs, Pagination, Stepper, Menu,
DropdownMenu, ContextMenu, NavigationMenu, Sidebar

Feedback / Status
Alert, Badge, Status, Progress, Spinner, Skeleton,
EmptyState, ErrorState, Toast, Tooltip

Overlay
Dialog, AlertDialog, Drawer, Sheet, Popover, HoverCard,
CommandPalette

Data Display
Avatar, Card, Panel, Accordion, Collapsible, List, DescriptionList,
Stat, Timeline, Tree, Table, DataTable

Data Visualization
Chart, Sparkline, Meter, Gauge, Legend, KPI, TrendIndicator

Layout Primitive
Box, Container, Stack, Inline, Grid, SplitPane

Application / Page Layout
AppShell, PageShell, Sidebar, PageHeader, Toolbar

Composite Pattern
SearchField, FilterBar, SortControl, BulkActions, ConfirmAction,
PaginationBar, DataToolbar, LoginForm, SettingsSection

Domain
프로젝트가 공통 UI를 조합해 업무 의미와 데이터만 연결
```

목록은 Cornerstone이 제공할 전체 범위다. Starter v1 release gate는 인증, 설정, CRUD와 Dashboard reference에 필요한 Foundation·Layout·Core Product UI로 고정하고, Chart, Tree, 고급 Date/File 입력과 CommandPalette 같은 Advanced UI는 별도 단계에서 같은 계약으로 확장한다. 동일 역할의 컴포넌트를 이름만 바꿔 중복하지 않는다.

### 6.2 Layout 책임

| Component    | 책임                                                                |
| ------------ | ------------------------------------------------------------------- |
| `Box`        | semantic element와 제한된 logical spacing/display escape hatch      |
| `Container`  | content max-width, responsive gutter, 중앙 정렬과 container context |
| `Stack`      | block 축 흐름, gap과 정렬                                           |
| `Inline`     | inline 축 정렬, gap과 wrapping                                      |
| `Grid`       | 명시적 column 또는 최소 item 폭 기반 auto-fit                       |
| `AppShell`   | app chrome, landmark, viewport 높이, safe area와 전역 scroll        |
| `PageShell`  | page content 폭, gutter와 수직 흐름                                 |
| `Sidebar`    | Domain을 모르는 navigation region과 collapse/open 상태              |
| `PageHeader` | breadcrumb, title, description과 actions 배치                       |
| `Toolbar`    | search, filter와 action group의 wrapping·overflow                   |

`Grid`의 `columns`와 `minItemWidth`처럼 서로 다른 배치 방식은 동시에 받지 않는 discriminated union으로 설계한다. `AppShell`은 `Header`, `Sidebar`, `Main` 같은 landmark slot을 제공하고 `PageShell`과 page content 크기를 중복 소유하지 않는다.

### 6.3 옵션과 이벤트 체계

같은 prop 이름은 모든 컴포넌트에서 같은 의미를 가져야 하며, 지원하지 않는 축을 억지로 노출하지 않는다.

| Prop           | 의미               | 공통 값                                                        |
| -------------- | ------------------ | -------------------------------------------------------------- |
| `size`         | 물리적 크기        | `xs`, `sm`, `md`, `lg`, `xl`의 필요한 부분집합                 |
| `variant`      | 시각 구조          | `solid`, `soft`, `outline`, `ghost`, `plain`의 필요한 부분집합 |
| `tone`         | semantic 색과 강조 | `neutral`, `brand`, `info`, `success`, `warning`, `danger`     |
| `orientation`  | 배치 방향          | `horizontal`, `vertical`                                       |
| `align`        | 교차축 정렬        | `start`, `center`, `end`, `stretch`, `baseline`                |
| `justify`      | 주축 정렬          | `start`, `center`, `end`, `between`, `around`                  |
| `gap`, `inset` | token 기반 간격    | spacing token                                                  |
| `fullWidth`    | 부모 폭 채움       | 명확한 이진 동작일 때만 boolean                                |

- `state="..."`를 만들지 않고 `loading`, `disabled`, `readOnly`, `invalid`, `selected`, `expanded`를 명시한다.
- `compact`, `danger`, `fluid`, `primary` 같은 겹치는 boolean 대신 `size`, `tone`, `variant`, `fullWidth`를 조합한다.
- Native event는 `onClick`, `onBlur`, `onFocus`, `onSubmit`을 유지한다.
- 상태 callback은 `onValueChange`, `onOpenChange`, `onCheckedChange`, `onSelectionChange`, `onCollapsedChange`로 통일한다.
- Controlled/uncontrolled는 `value/defaultValue`, `open/defaultOpen`, `checked/defaultChecked`, `selectedKeys/defaultSelectedKeys` 쌍을 사용한다.
- Layout prop은 layout primitive에 집중하고 Button/Input에 margin, grid prop을 누적하지 않는다.
- 구조와 focus 조정이 필요한 경우 `Dialog.Root/Trigger/Content`, `AppShell.Header/Sidebar/Main` 같은 compound API를 사용한다.
- 단순 위치는 `startIcon`, `endIcon`, `description`, `actions` 같은 named slot을 사용한다.
- Root에는 `className`, 필요한 `style`, `data-*`, `aria-*`, `ref`를 허용하되 private class와 DOM 구조는 계약으로 삼지 않는다.
- `as`는 `Box`, `Stack`, `Inline`, `Typography`처럼 semantic 교체가 안전한 primitive에 제한하고 `asChild`와 동시에 제공하지 않는다.
- 공개 export나 prop을 바꿀 때 `@deprecated`, 대체 API, migration example과 호환 기간을 제공한다.

### 6.4 Adaptive 정책

- `AppShell/Sidebar`: viewport 기준으로 navigation rail과 controlled Drawer를 전환하고 focus 복귀와 현재 위치를 보존한다.
- `PageHeader/Toolbar`: container 기준으로 action을 다음 줄 또는 overflow menu로 옮기되 중요 action을 자동 숨기지 않는다.
- `Tabs/Breadcrumb/Pagination`: wrapping, scroll, collapse 또는 overflow 중 지원 정책을 컴포넌트별로 고정한다.
- Form: 좁은 container에서 한 열로 배치하되 label, error, tab order와 최소 hit target을 유지한다.
- Dialog/Drawer: viewport가 좁다는 이유만으로 암묵적으로 교체하지 않고 호출자가 adaptive policy를 선택한다.
- Table/DataTable: 기본은 label이 있는 가로 scroll이다. Column 숨김·우선순위·card view는 소비자가 명시한다.
- Chart: container resize에 반응하고 accessible name, 요약과 표 형태 대체를 제공한다.
- Shell/Overlay: `100dvh`, safe-area inset, scroll lock과 virtual keyboard에서도 focus 대상이 가려지지 않게 한다.
- CSS의 시각적 재배치로 DOM 읽기 순서와 keyboard focus 순서를 바꾸지 않는다.

### 6.5 공통 계약

- Headless behavior와 Cornerstone visual preset을 분리하되 기본 사용만으로 완성된 외형을 제공한다.
- 가능한 컴포넌트는 controlled/uncontrolled 사용, `ref`, keyboard와 screen reader를 지원한다.
- `size`, `variant`, `tone`과 명시적 state API를 컴포넌트군 전체에서 일관되게 유지한다.
- loading, empty, error, success, disabled와 read-only 상태를 공개 계약으로 다룬다.
- form control은 label, description, required와 error 연결 방식을 공유한다.
- overlay는 focus 이동·복귀, Escape, backdrop와 중첩 정책을 공유한다.
- data component는 loading/empty/error, pagination, sort, filter와 selection 상태를 조합 가능하게 제공한다.
- responsive behavior와 Density 변화가 기능 또는 정보 우선순위를 손상하지 않게 한다.
- motion은 `prefers-reduced-motion`, 색과 상태는 WCAG contrast를 고려한다.
- Composite는 Domain을 알지 못하며 API를 직접 호출하지 않는다.

### 6.6 통일성

통일성은 앱별 CSS 복사가 아니라 token과 공통 API로 유지한다.

- Appearance 변경은 공통 token resolution에서 처리하고 개별 컴포넌트 조건문으로 분산하지 않는다.
- 동일한 상태와 행동은 컴포넌트가 달라도 같은 색, 간격, motion과 용어를 사용한다.
- 앱의 임의 색상·간격·radius 사용을 제한하고 public token 또는 variant로 확장한다.
- Story catalog에서 모든 상태, Appearance와 Density 조합을 탐색하고 시각 회귀를 검증한다.

## 7. 확장과 승격 원칙

프로젝트는 public token과 component API를 통해 Appearance와 Domain을 확장한다. 공통 package 내부 파일을 직접 import하거나 fork하지 않는다.

표준 UI 범위 밖의 신규 패턴과 추상화에 적용하는 승격 조건:

1. 서로 다른 실제 프로젝트에서 같은 문제가 반복된다.
2. Domain 지식을 제거해도 유용하다.
3. API, 접근성, 테스트와 운영 책임을 명확히 정의할 수 있다.
4. 기존 소비자와 호환되는 도입·제거 경로가 있다.

## 8. 관련 문서

- [`../README.md`](../README.md): 프로젝트 진입점과 표준 명령
- [`cornerstone_implementation_plan.md`](./cornerstone_implementation_plan.md): 현재 상태와 구현 순서
- [`atlas-industrial-violet.html`](./atlas-industrial-violet.html): Industrial + Signal Violet 레퍼런스
- [`../apps/web/README.md`](../apps/web/README.md): Web 앱 실행과 경계
- [`../apps/api/README.md`](../apps/api/README.md): API 앱 실행과 경계
