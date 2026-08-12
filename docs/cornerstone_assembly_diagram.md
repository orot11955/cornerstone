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
- 두 개 이상의 실제 프로젝트에서 반복된 추상화만 공통 기반으로 승격한다.
- 보안, 데이터 무결성, 관측 가능성과 배포 복구 절차를 초기 구조에 포함한다.

## 2. 제품 경계

### Core

- pnpm Workspace와 Turborepo 기반 Monorepo
- Next.js Web과 NestJS API
- 공통 TypeScript, lint, format 설정
- 환경 변수 검증, 표준 오류, 요청 추적과 구조화 로그
- PostgreSQL, TypeORM, Migration과 Seed 규칙
- User, Session, Cookie 인증과 Role 기반 인가의 기본 경계
- API client, query, form과 공통 UI
- 디자인 토큰과 Appearance preset
- Unit, Integration, E2E, CI와 Production image의 기본 계약

### Optional

- Redis, Queue, Scheduler, WebSocket, SSE
- OAuth, 2FA, 메일, Object Storage
- 특정 Cloud 또는 배포 플랫폼 adapter
- 조직·Tenant 기반의 복합 Permission

### Starter에서 제외

- 프로젝트별 업무 Entity, 화면, API와 Domain token
- 검증된 사용 사례가 없는 범용 추상화
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
│  ├─ ui/                  토큰과 Domain 독립 UI
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
- 개발, 테스트와 운영 DB를 분리한다.
- Seed는 멱등이고 운영에서 자동 실행하지 않으며 비밀정보를 포함하지 않는다.

### Operations

- liveness와 readiness를 분리하고 필수 dependency만 readiness에 포함한다.
- 로그에는 token, password, Cookie 원문과 불필요한 개인정보를 남기지 않는다.
- 앱 replica 시작과 Migration 실행을 분리한다.
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

| 축 | 책임 | 기본 지원 값 |
| --- | --- | --- |
| Theme | 명도와 환경 선호 | `light`, `dark` |
| Style | 형태, 표면, 대비와 시각 문법 | `industrial`, `minimal`, `soft` |
| Brand | 상호작용과 선택의 정체성 색 | `signal-violet`, `orange`, `emerald`, `custom` |
| Density | 공간과 컨트롤 크기 | `compact`, `default`, `comfortable` |

DOM에는 해석된 값을 선언한다.

```html
<html
  data-theme="dark"
  data-style="industrial"
  data-brand="signal-violet"
  data-density="default"
>
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

## 6. UI 계층

```text
Primitive
Button, Input, Select, Checkbox, Radio, Switch, Dialog

Composite
FormField, SearchField, ConfirmDialog, DataTable, Pagination

Layout
AppShell, Header, Sidebar, PageHeader, Panel

Domain
각 프로젝트가 Composite와 Layout을 조합해 구현
```

- Primitive는 접근성, keyboard interaction과 focus 동작을 보존한다.
- Composite는 Domain을 알지 못하며 API를 직접 호출하지 않는다.
- loading, empty, error, disabled 상태를 공개 계약으로 다룬다.
- motion은 `prefers-reduced-motion`, 색과 상태는 WCAG contrast를 고려한다.

## 7. 확장과 승격 원칙

프로젝트는 public token과 component API를 통해 Appearance와 Domain을 확장한다. 공통 package 내부 파일을 직접 import하거나 fork하지 않는다.

공통 기반 승격 조건:

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
