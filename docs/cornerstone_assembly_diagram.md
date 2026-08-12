# Cornerstone 아키텍처와 설계 원칙

> 이 문서는 Cornerstone의 영속적인 설계 계약을 정의한다. 구현 순서와 현재 상태는
> [`cornerstone_implementation_plan.md`](./cornerstone_implementation_plan.md)를 따른다.

## 1. 목적

Cornerstone은 새 TypeScript 풀스택 프로젝트마다 반복되는 기반을 공통 패키지와 하나의 canonical template으로 제공하는 Starter Kit이다. 특정 제품의 Boilerplate나 모든 기능을 한꺼번에 설치하는 배포물이 아니라, 초기 설정에서 선택한 기능과 디자인만 검증된 조합으로 생성하는 기반 플랫폼을 지향한다.

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

Core는 기본 Certified Profile인 `standard`가 보장할 범위다.

- pnpm Workspace와 Turborepo 기반 Monorepo
- Next.js Web과 NestJS API
- 공통 TypeScript, lint, format 설정
- 환경 변수 검증, 표준 오류, 요청 추적과 구조화 로그
- PostgreSQL, TypeORM, Migration과 Seed 규칙
- User, Session, Cookie 인증, 계정 검증·복구와 Role 기반 인가의 기본 경계
- API client, query, form과 포괄적인 공통 UI Kit
- 디자인 토큰과 Appearance preset
- Unit, Integration, E2E와 CI의 기본 계약

### Optional

- Redis, Queue, Scheduler, WebSocket, SSE
- OAuth, MFA, Mail delivery provider, Object Storage
- 특정 Cloud 또는 배포 플랫폼 adapter
- 조직·Tenant 기반의 복합 Permission

Mail provider는 Optional이지만 verification/recovery token, recent-auth, Session 관리와 메시지 전달 port는 Core 계약이다. 개발·테스트는 capture/fake adapter를 사용하고 Production에서 해당 기능을 활성화하면 승인된 provider 구성을 필수로 한다.

Starter v1 Core는 global User identity와 single-tenant application으로 고정한다. Tenant는 nullable column이나 runtime flag로 미리 가장하지 않고 별도 capability와 schema baseline으로 제공한다.

### 프로젝트 조합 모델

Template 원천은 하나만 유지하고 프로젝트 초기 설정에서 capability manifest를 먼저 확정한다. 상세 결정은 [ADR-0015](./adr/0015-project-composition.md)를 따른다.

| Profile      | 구성                                                           | 보장 범위                                 |
| ------------ | -------------------------------------------------------------- | ----------------------------------------- |
| `minimal`    | Web, API, Config, UI Foundation                                | 작은 서비스와 실험용 Certified Profile    |
| `standard`   | Minimal + PostgreSQL/TypeORM + password-session Auth + Core UI | 기본 Certified Profile                    |
| `production` | Standard + 운영 관측·배포·복구·공급망                          | 필수 provider를 해소한 Production overlay |
| `regulated`  | Production + privacy/audit/residency 확장점                    | 규제 대응 Foundation, 법적 준수 보증 아님 |

Profile은 별도 Template이 아니라 자주 쓰는 capability 선택 preset이다. Capability는 선택 가능한 기능 단위, Adapter는 기술 구현, Provider는 Adapter가 연결하는 외부 서비스나 실행 환경, Extension은 Core와 독립 배포되는 optional capability를 뜻한다. 고급 사용자는 지원되는 capability를 조합할 수 있지만 Certified, Supported와 Experimental 수준을 명시한다.

```yaml
schemaVersion: 1
profile: standard

capabilities:
  web: next
  api: nest
  ui: core
  data: postgres-typeorm
  auth: password-session

extensions:
  tenant: none
  mail: capture
  queue: none
  storage: none
  realtime: none

appearance:
  theme: system
  style: minimal
  brand: signal-violet
  density: default
```

- Generator는 dependency/conflict, runtime/package/schema compatibility, Production 필수 provider 누락과 fake adapter 사용을 파일 생성 전에 거절한다.
- 선택하지 않은 capability의 코드, dependency, 환경 변수, 인프라와 문서는 생성 프로젝트에 포함하지 않는다.
- 사용자 소유 `cornerstone.config.yml`에는 Profile, capability, Appearance와 provider reference 같은 생성 의도만 기록한다.
- Generator 소유 `.cornerstone/manifest.lock.json`에는 resolved capability, generator/template/package version, schema baseline, compatibility와 적용한 template/fragment checksum을 기록한다.
- 두 manifest에는 secret·credential·개인정보 값을 저장하지 않고 환경 변수 이름이나 외부 secret reference만 허용한다.
- `production`은 운영 요구를 활성화하는 overlay다. Mail, hosting, registry, secret store와 backup 등 필수 slot은 생성 시 구체적인 provider/version으로 해소하고 그 exact matrix를 검증해야 Certified가 된다.
- 여러 capability가 공유 파일을 수정하면 파일별 단일 owner의 versioned structured composer가 결정적인 순서로 병합한다. 임의 text patch와 신뢰하지 않은 remote Generator plugin은 Starter v1 계약에 포함하지 않는다.
- 공통 수정은 package update로 전달하고 사용자 파일은 자동 덮어쓰지 않는다. 구조 변경은 dry-run, 예상 diff와 migration guide를 우선한다.
- Docs는 사용자 manifest와 lock manifest를 읽어 현재 구성에 해당하는 설치·운영·upgrade 문서를 필터링할 수 있다.

### Starter에서 제외

- 프로젝트별 업무 Entity, 화면, API와 Domain token
- 표준 UI 범위 밖에서 검증된 사용 사례가 없는 범용 추상화
- 특정 Brand 또는 Style에 종속된 컴포넌트 계약

## 3. 시스템 구조

아래는 목표 구조다. 현재 `infra`, `e2e`, `scripts`와 일부 package는 placeholder이며 실제 구현 상태는 구현 계획의 기준선 표를 따른다.

```text
cornerstone/
├─ apps/
│  ├─ web/                 Next.js UI와 사용자 흐름
│  ├─ api/                 NestJS API와 서버 정책
│  └─ docs/                별도 배포 문서·예제·다운로드 포털
├─ packages/
│  ├─ api-client/          HTTP 계약과 오류 변환
│  ├─ config/              공유 가능한 설정 schema와 상수
│  ├─ eslint-config/       공통 정적 분석 설정
│  ├─ schemas/             런타임 입력 검증
│  ├─ tsconfig/            실행 환경별 TypeScript 설정
│  ├─ types/               직렬화 가능한 공통 타입
│  ├─ ui/                  토큰과 포괄적인 Domain 독립 UI Kit
│  ├─ utils/               환경 독립 pure utility
│  └─ create-cornerstone/  Manifest 검증과 프로젝트 생성 CLI
├─ templates/
│  └─ canonical/           단일 Template 원천과 capability fragment
├─ infra/                  로컬·운영 인프라 정의
├─ e2e/                    사용자 핵심 경로 검증
├─ examples/               컴파일·시각 검증하는 예제와 reference 화면
├─ docs/                   저장소 내부 설계, 계획과 운영 기록
└─ scripts/                반복 가능한 관리 작업
```

목표로 하는 허용 의존 방향은 다음과 같다. M1 전에는 모든 연결이 실제 package dependency로 구현된 상태를 의미하지 않는다.

```text
apps/web ─┬─> api-client ─> schemas/types
          └─> ui ─────────> types/utils

apps/api ────────────────> schemas/types/utils/config

apps/docs ─┬─> 공개 package API와 versioned docs content
           └─> 검증된 examples와 release manifest

create-cornerstone ─> manifest schema + canonical template

low-level packages -X-> apps
packages/ui       -X-> API 또는 프로젝트 Domain
```

순환 의존, Entity의 API 노출, 앱 내부 경로를 향한 package 의존은 허용하지 않는다.

### 3.1 공통 패키지 책임

공통 코드를 한 패키지에 모으지 않고 런타임과 책임에 따라 분리한다.

| Package              | 소유 책임                                                   | 포함하지 않는 것                                  |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `types`              | 직렬화 가능한 공통 wire·structural type                     | runtime 검증, Entity, React/browser type          |
| `schemas`            | 외부 입력의 runtime 검증과 추론 type                        | transport, UI, Domain allowlist                   |
| `config`             | 환경 독립 설정 계약·기본값·조합                             | secret, 앱별 env 읽기, 전역 `process.env` 접근    |
| `utils`              | 환경 독립적이고 결정적이며 부작용 없는 함수                 | DOM hook, HTTP·보안 정책, Domain 규칙             |
| `api-client`         | HTTP, 직렬화, 취소, 오류 envelope 변환                      | Query cache, Toast, Router, React hook, 권한 판단 |
| `ui`                 | token, component, layout, 접근성 behavior와 UI browser hook | API 호출, Auth·Domain 정책                        |
| `create-cornerstone` | manifest/preset 검증, capability 해석과 생성 plan           | Runtime Domain 로직, 사용자 파일 무단 overwrite   |
| `apps/web`           | Route, Domain 조합, Query/Auth 상태와 endpoint hook         | 공통 Primitive 재구현                             |

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

Cornerstone은 저장소 복제본 하나가 아니라 버전이 있는 공통 패키지, 생성 CLI와 canonical template의 조합으로 배포한다.

```text
@cornerstone/* packages       버전이 있는 재사용 계약과 구현
create-cornerstone            Manifest 검증, preset 해석과 생성 CLI
Canonical template            apps, infra, root config의 단일 원천
Project lock manifest        생성 결과의 resolved capability와 정확한 버전
Release manifest             공개 artifact의 호환성·checksum·provenance
Migration guide              복사된 파일의 수동 업그레이드 절차
```

- Starter v1 Core package는 같은 버전으로 묶는 synchronized release를 사용한다. Extension package는 독립 SemVer로 배포하고 지원 Core/Profile 범위를 release manifest에 선언한다.
- 생성 프로젝트는 `.cornerstone/manifest.lock.json`에 정확한 package/generator/template 버전, resolved capability, 지원 Node/pnpm 범위와 DB schema baseline을 기록한다.
- 공통 수정은 package update로 전달하고 생성된 프로젝트의 앱·인프라 파일을 자동 덮어쓰지 않는다.
- 공개 package는 workspace link가 없는 임시 소비자에서 tarball 설치, typecheck와 build를 검증한다.
- Certified Profile은 빈 디렉터리에서 생성, 설치, 필요한 Migration, 핵심 E2E와 해당 Profile의 release Gate까지 검증한다.
- 직전 생성 결과에 대표 사용자 변경을 적용한 fixture에서 package update와 migration guide를 각각 리허설하고 사용자 소유 파일을 보존한다.
- Registry와 배포 provider가 정해지기 전에도 local tarball과 versioned template archive로 같은 계약을 검증한다.
- Root, 공개 package, Template, example과 Docs content의 license, SPDX identifier, attribution과 재배포 범위를 일관되게 고정한다.
- 생성 프로젝트의 제품 코드 license는 사용자가 명시적으로 선택하고, Cornerstone에서 유래한 package·재배포 파일의 필수 `NOTICE`와 attribution은 보존한다. 선택하지 않으면 임의의 제품 license를 자동 부여하지 않는다.
- Release artifact에 `LICENSE`, 필요한 `NOTICE`와 third-party attribution을 포함하고 dependency license allow/deny 정책을 CI에서 검사한다.

### 3.4 Documentation Portal 배포 모델

`apps/docs`는 제품 Web/API와 분리된 origin과 release lifecycle을 갖는 공개 문서 포털이다. 저장소 내부 `docs/`는 설계와 운영 기록의 원천이고, 공개 포털은 사용자용 설명·예제·다운로드 경험을 소유한다.

```text
Versioned docs content ─┬─> 문법·개념·API reference
Typed source/examples ──┼─> 코드 예제·실행 preview·예시 화면
Release manifest ───────┼─> 버전 호환성·checksum·provenance
Artifact storage/CDN ───┴─> package/template 다운로드
```

문서 정보 구조:

- Getting Started: 요구 runtime, 설치, 프로젝트 생성, 첫 실행과 배포 전 점검
- Foundations: token 계층, Theme/Style/Brand/Density 문법과 naming 규칙
- Components: import, props/options, 상태, responsive 값, 접근성, 예제와 migration
- Layout/Patterns: AppShell, PageShell, 인증, 설정, CRUD, Dashboard 조합
- API/Backend: 환경 변수, OpenAPI, auth/authorization, Migration과 운영 명령
- Examples/Showcase: 실제 package를 import한 실행 화면, viewport·Appearance·locale 조합과 source
- Releases/Downloads: version별 package/template, compatibility, changelog, checksum, provenance와 upgrade guide

문서와 예제 계약:

- 코드 조각은 복사 전용 문자열로 중복 관리하지 않고 typecheck/build/test 가능한 example source에서 추출하거나 참조한다.
- Component reference는 public type/export와 연결해 존재하지 않는 prop, token, import path와 제거된 API를 CI에서 거절한다.
- 예시 화면은 Cornerstone package의 release candidate를 실제 소비하며 앱 내부 source나 workspace 우연성에 의존하지 않는다.
- Preview는 고정된 fixture만 실행한다. 임의 사용자 코드를 서버에서 실행하지 않으며 필요 시 sandboxed iframe과 분리 origin을 사용한다.
- 문서는 지원 중인 release별 snapshot을 보존한다. `/latest`는 redirect일 뿐이며 검색 결과, deep link와 다운로드는 명시적 version URL을 사용한다.
- 문서 배포가 package/template publish보다 먼저 새 버전을 안내하지 않도록 release manifest의 published 상태를 기준으로 노출한다.

다운로드와 서빙 계약:

- 문서 앱은 대용량 artifact를 runtime proxy하지 않고 검증된 object storage/CDN의 immutable digest URL을 release manifest로 안내한다.
- `latest.zip` 같은 mutable 파일을 신뢰 경계로 사용하지 않는다. 버전, digest, 크기, checksum, 서명/provenance와 지원 runtime을 함께 표시한다.
- Artifact upload principal과 Docs deploy principal을 분리하고 공개 bucket은 list/write를 금지한다.
- CDN은 HTTPS, 올바른 `Content-Type`/`Content-Disposition`, 무결성 metadata와 versioned cache policy를 사용한다.
- 철회된 artifact는 이유와 대체 버전을 문서에 표시하고 신규 다운로드를 차단하되 감사와 사고 분석을 위한 release 기록은 보존한다.
- Docs origin은 CSP, framing 제한, dependency/secret scan, rate limit과 가용성 관측을 적용하며 제품 Cookie나 운영 secret을 공유하지 않는다.

### 3.5 호환성 정책

| 계약           | 변경 원칙                                                  |
| -------------- | ---------------------------------------------------------- |
| Package export | SemVer, additive 우선, 제거는 major와 migration guide      |
| REST API       | additive 우선, 제거·의미 변경은 versioning과 consumer 전환 |
| Environment    | rename 시 호환 alias와 deprecation 기간 제공               |
| Database       | N/N-1 앱 read/write 호환과 expand/backfill/contract        |
| Cookie/Session | key overlap, TTL과 명시적인 강제 로그아웃 조건             |
| UI token/prop  | `@deprecated`, 대체 API와 호환 adapter 제공                |
| Template       | 자동 overwrite 금지, release별 수동 migration guide 제공   |
| Documentation  | 지원 버전 snapshot 유지, code/API drift 차단과 폐기 안내   |

공개 계약, 환경 변수, Migration, OpenAPI와 generated artifact는 변경 소유자를 하나만 둔다. Breaking change는 영향 소비자, 전환 순서, rollback 또는 roll-forward와 지원 종료 시점을 기록한다.

### 3.6 계층화된 Release Gate

모든 기능을 하나의 v1 완료 조건에 묶지 않는다. 상세 결정은 [ADR-0017](./adr/0017-release-gates.md)을 따른다.

| Gate             | 완료 범위                                                        | 주요 Artifact                           |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------- |
| Foundation       | Workspace, shared package, UI Foundation, 외부 소비 검증         | Package tarball, Foundation stable Docs |
| Standard Starter | 기본 Certified Profile의 Web/API/Data/Auth/Core UI               | 생성 CLI, standard Profile artifact     |
| Production Ready | Provider-resolved image, Migration 배포, 관측, SLO, load/restore | Production Profile과 운영 evidence      |
| Regulated        | Privacy/audit/residency/encryption 확장점                        | Regulated manifest와 검증 harness       |
| Extension        | 활성 capability별 adapter와 contract                             | 독립 extension package                  |

- Capability별 Gate는 해당 기능이 활성화될 때 필수다.
- 입력 검증, secret scan, default-deny, build 재현성과 artifact integrity는 모든 Profile의 공통 Gate다.
- SLO, retention과 residency의 실제 값은 프로젝트가 manifest/운영 설정으로 선언하고 Starter는 schema, 기본값, harness와 검증 방법을 제공한다.
- Regulated Profile은 법적 준수를 보증하지 않고 프로젝트가 적용 법률과 provider에 맞게 완성할 Foundation을 제공한다.
- Standard Core E2E, Production load/restore/SLO, Regulated privacy/audit와 Extension contract Gate는 별도로 판정하며 상위 Profile 실패가 하위 release를 차단하지 않는다.
- Docs preview는 package/API/UI 변경과 함께 배포하고 stable version만 artifact publish 후 공개한다.

## 4. 애플리케이션 경계

### Frontend

- Server/Client 경계를 명시하고 요청 간 인증 및 Query 상태를 공유하지 않는다.
- API 접근은 `api-client`로 모으고 화면 컴포넌트가 transport 세부사항에 의존하지 않게 한다.
- Client validation은 UX를 위한 1차 검증이며 서버 검증을 최종 기준으로 한다.
- Route 보호와 별개로 API가 항상 인증과 권한을 검증한다.

### Next/BFF 신뢰 경계

- 상태 변경과 Session 권위는 Nest API가 소유한다. Route Handler와 Server Action은 승인된 API adapter를 통해서만 전달한다.
- API origin은 server-only 설정으로 고정하며 Browser 입력으로 URL, host 또는 upstream을 조합하는 범용 proxy를 제공하지 않는다.
- `Host`, hop-by-hop, `X-Forwarded-*`, `X-User-*` 등 Browser 제공 신뢰 header를 제거하고 필요한 metadata는 신뢰 경계에서 재생성한다.
- API는 BFF가 전달한 사용자 식별 header를 신뢰하지 않고 token/session을 독립적으로 검증한다.
- 상태 변경 Next 경로에도 API와 같은 Origin/CSRF, rate limit, redaction과 audit 정책을 적용한다.
- 외부 URL 호출이 필요해지면 scheme, host/IP, redirect, DNS 재해석과 egress를 다루는 별도 SSRF Gate를 통과해야 한다.

### Backend와 API

- `Controller → Service → Repository` 책임을 유지한다.
- DTO와 Mapper로 API 계약을 Entity에서 분리한다.
- OpenAPI를 서버 계약의 기준으로 삼고 날짜는 ISO 8601 UTC 문자열로 직렬화한다.
- 오류 응답은 안정적인 code, 안전한 message, request ID를 제공한다.
- 입력값, CORS origin, Cookie, CSRF와 권한을 명시적으로 검증한다.

### 인증과 권한

- 전역 인증 Guard를 기본으로 적용한다. `@Public`은 Controller 상속 없이 handler 단위로만 허용하고 route별 사유·소유자·HTTP method를 승인 allowlist에 기록한다.
- 권한 metadata나 endpoint × role × ownership matrix에 없는 route는 default-deny한다.
- Controller뿐 아니라 Service/Repository query도 principal과 ownership scope를 적용한다.
- `role`, `status`, ownership과 permission은 Client 입력을 신뢰하지 않으며 mass assignment를 차단한다.
- Access token에는 최소 subject/session/authz version을 둔다. Logout, Session revoke, Role·상태·비밀번호·permission·ownership 변경과 삭제의 revoke 전파 상한, authz cache TTL·무효화와 authoritative store 장애 시 fail-closed 범위를 정의한다.
- 민감 endpoint는 현재 User/Session 상태 또는 authz version을 재검증한다.
- Route inventory와 권한 matrix의 drift를 CI에서 비교하고 미분류 route가 있으면 실패한다.
- Admin bootstrap은 public endpoint가 아닌 승인된 one-off job/CLI로 실행한다. 별도 단기 principal, 최소 DB 권한과 protected-environment 승인을 사용하고 runtime image에서 artifact를 제외하며 zero-admin 조건, DB lock, 감사, 사용 후 폐기와 재실행 거절을 보장한다.

### 계정 검증과 복구

- Password 인증을 제공하면 email verification, forgot/reset, password change, recent-auth와 활성 Session 조회·개별/전체 revoke를 Core 흐름으로 제공한다.
- Verification/recovery token은 목적, subject, 만료, single-use와 attempt limit를 가지며 원문을 저장하지 않는다.
- 존재하지 않는 계정에도 같은 외부 응답과 유사한 처리 시간을 사용해 사용자 열거를 막는다.
- Password reset, email 변경과 계정 복구는 기존 access/refresh Session 폐기, `authzVersion` 증가와 감사 event를 원자적으로 연결한다.
- Mail delivery는 port로 분리한다. Request transaction과 외부 전송을 직접 묶지 않고 transactional outbox 또는 동등한 durable handoff를 사용한다.
- Production에서 verification/recovery를 활성화하면 승인된 Mail provider, sender/domain 검증, bounce/complaint와 rate limit 정책이 없을 때 기동 또는 기능 활성화를 거절한다.

### Tenant와 Identity Scope

- Core는 global `User` identity, global normalized email unique와 application-scoped Role/ownership을 사용한다. 상세 결정은 [ADR-0016](./adr/0016-identity-scope.md)을 따른다.
- Single-tenant Core의 모든 query에 암묵적 Tenant를 가장하거나 사용하지 않는 nullable `tenantId`를 추가하지 않는다.
- Tenant capability는 global User를 유지하고 `Tenant`와 `Membership`으로 tenant-scoped Role/status/authz version을 표현한다.
- Tenant variant는 principal의 active membership을 authoritative source에서 확인하고 `tenantId`를 Client header/body만으로 결정하지 않는다.
- Core에서 Tenant capability로 전환하는 expand/backfill/contract와 cross-tenant IDOR, cache key, background job, file path, audit/observability 격리를 검증한다.

### 신뢰 가능한 변경 요청과 Side Effect

- 재시도 가능한 상태 변경은 idempotency key의 scope, TTL, payload hash, replay response와 충돌 의미를 고정한다.
- Optimistic concurrency는 version/ETag와 `409/412` 의미를 사용하고 blind overwrite를 허용할 endpoint를 명시한다.
- Client와 Server는 timeout, cancel, retry 가능한 오류, backoff와 retry 금지 요청을 같은 계약으로 사용한다.
- DB 변경과 Mail/Queue/Webhook 같은 외부 side effect는 transaction/outbox 경계를 명시하고 at-least-once 전달의 deduplication 책임을 정한다.
- Outbound HTTP는 allowlisted destination, connect/request timeout, bounded response, redirect, retry budget와 circuit/bulkhead 정책을 공통 adapter에서 적용한다.

### Data

- User lifecycle, email 재사용·정규화, Role/상태, 삭제·익명화·보존과 Session revoke 계약을 첫 Migration 전에 확정한다.
- `synchronize=false`를 유지하고 모든 schema 변경은 검토 가능한 Migration으로 적용한다.
- 배포는 `expand → migrate/backfill → contract` 호환 순서를 기본으로 한다.
- 빈 DB뿐 아니라 지원하는 직전 release의 schema/data와 구·신 앱 조합에서 Migration과 read/write 호환을 검증한다.
- 개발, 테스트와 운영 DB를 분리한다.
- Seed는 멱등이고 운영에서 자동 실행하지 않으며 비밀정보를 포함하지 않는다.

### Data Governance와 Privacy

Core는 분류·redaction·삭제 확장점만 보장하고 아래 전체 운영 Gate는 `regulated` Profile이 활성화될 때 적용한다.

- 데이터 field를 public/internal/confidential/restricted로 분류하고 저장, log, trace, analytics, export와 backup 허용 범위를 연결한다.
- User 데이터 access/export, correction, deletion과 consent/analytics opt-out의 Foundation hook과 Domain 책임을 분리한다.
- Retention 종료와 삭제는 primary DB뿐 아니라 replica, cache, search index, log, artifact와 backup의 전파·예외·증거를 정의한다.
- Field-level encryption/tokenization 적용 기준, key ownership·rotation과 검색/index 제약을 정한다.
- Region/residency 요구는 provider adapter가 선언하고 지원하지 않는 배치를 startup/deploy Gate에서 거절한다.
- 개인정보 조회·export·삭제와 관리자 대리 작업은 목적, actor, scope와 결과를 변조 방지 audit로 기록한다.

### Operations

기본 metric/log/correlation은 Core에 포함하고 SLO·capacity·backup·배포 evidence는 `production` Profile에서 완료한다.

- liveness와 readiness를 분리하고 필수 dependency만 readiness에 포함한다.
- 로그에는 token, password, Cookie 원문과 불필요한 개인정보를 남기지 않는다.
- 구조화 로그, metric과 trace/correlation context로 요청에서 DB 오류까지 연결한다.
- 앱 replica 시작과 Migration 실행을 분리한다.
- Build artifact는 한 번 만들고 검증한 동일 digest를 환경 간 승격한다.
- Runtime, Migration과 배포 principal을 분리하고 최소 권한을 적용한다.
- Backup은 암호화, 별도 최소 권한, 불변성, checksum, 접근 감사와 보존·파기 정책을 갖는다.
- Restore 후 access JWT와 refresh/session을 각각 무효화한다. revoke·삭제·권한 변경 journal은 복원 대상 DB와 분리된 append-only 불변 저장소에 두고 재적용하며 auth epoch와 signing/refresh key rotation 범위를 함께 검증한다.
- JWT, CI/OIDC, registry/signing과 backup 침해별 freeze, revoke, rotate, audit, 재발행 runbook과 정기 drill을 유지한다.
- 변경마다 검증, 배포 순서와 rollback 가능성을 기록한다.
- 핵심 사용자 경로와 API/DB/Docs/Download 및 활성화된 Queue extension의 SLI·SLO, error budget, alert severity·owner·응답 시간을 정의한다.
- Metric label cardinality, log/trace 보존과 sampling, observability 비용 예산을 release별로 검증한다.
- 부하·soak·burst test로 request concurrency, DB/HTTP pool, queue lag, memory와 graceful degradation 한계를 확인한다.

### Optional Extension 계약

- Redis, Queue/Scheduler, Realtime, OAuth/MFA, Mail과 Object Storage는 Core가 provider SDK를 직접 import하지 않는 port/adapter 구조를 사용한다.
- 각 extension은 package name, server/browser export, config schema, local fake, health/readiness, metric와 contract test를 제공한다.
- Provider 미설정 시 기능 비활성 또는 fail-fast를 명시하고 silent fallback이나 in-memory Production 대체를 허용하지 않는다.
- Queue는 retry/backoff, deduplication, visibility/lease, DLQ와 poison message 운영을 정의한다.
- Realtime은 인증 갱신, reconnect/resume, ordering, backpressure와 connection quota를 정의한다.
- OAuth/MFA는 account linking, provider email trust, step-up/recovery와 factor revoke를 기존 Session/authz 계약에 연결한다.
- Object Storage는 content type/size, malware scan, quarantine, signed URL, path/key와 delete/retention을 검증한다.

### Web Platform

- Locale, timezone, currency와 숫자·날짜 formatting의 소유자를 정하고 SSR/CSR에서 같은 결과를 보장한다.
- `lang`, `dir`, 번역 key, fallback과 긴 문자열/RTL/CJK 검증을 공통 계약으로 둔다.
- Metadata, title/description, canonical, robots, sitemap과 social preview의 기본 API를 제공하되 Domain 값은 앱이 소유한다.
- `not-found`, 예상 오류, 전역 오류와 offline/network 오류 경계를 분리하고 안전한 복구·retry UX를 제공한다.
- Web Vitals, Browser error와 release/correlation context를 수집하되 URL·사용자 입력과 PII를 allowlist 기반으로 제한한다.
- JavaScript/CSS, route chunk, font/image와 핵심 사용자 경로의 성능 예산을 release Gate로 관리한다.
- Web response는 CSP, `frame-ancestors`, `nosniff`, Referrer/Permissions Policy와 운영 HSTS 책임을 명시한다.
- 접근성 목표는 WCAG 2.2 Level AA이며 자동 검사와 keyboard, screen reader, zoom을 포함한 수동 검증을 함께 사용한다.

### 개발 생산성

- Feature/package/Migration generator는 프로젝트 구조와 공개 경계를 강제하고 생성 직후 typecheck/test가 가능해야 한다.
- OpenAPI client, token, project lock/release manifest와 release note 생성은 재현 가능한 명령으로 제공한다.
- Dependency update, deprecation, changelog와 migration guide를 package/template release 흐름에 연결한다.
- 공통 명령은 check와 fix를 분리하고 로컬·CI가 같은 script와 artifact를 사용한다.
- Cornerstone release 저장소는 `CODEOWNERS`, protected branch와 required review/status check로 Migration, Auth/권한, OpenAPI, lockfile, release workflow와 manifest의 문서상 소유권을 강제한다.
- 생성 프로젝트에는 provider-neutral 권장 정책과 예시를 제공하고 실제 GitHub/GitLab branch protection 적용은 선택한 provider adapter가 소유한다.
- Emergency/break-glass 변경은 시간 제한 승인, 사후 review와 audit를 요구하고 필수 보안·무결성 Gate를 우회하지 않는다.

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

| 축      | 책임                         | 기본 지원 값                                                |
| ------- | ---------------------------- | ----------------------------------------------------------- |
| Theme   | 명도와 환경 선호             | `light`, `dark`                                             |
| Style   | 형태, 표면, 대비와 시각 문법 | `industrial`, `minimal`, `soft`                             |
| Brand   | 상호작용과 선택의 정체성 색  | `signal-violet`, `orange`, `emerald`, 등록된 프로젝트 Brand |
| Density | 공간과 컨트롤 크기           | `compact`, `default`, `comfortable`                         |

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

프로젝트 Brand는 `custom`이라는 단일 DOM 값을 사용하지 않는다. `createBrand({ name: 'acme', ... })`처럼 안정적인 key와 semantic token override를 등록하고 DOM에는 `data-brand="acme"`로 해석한다.

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
├─ container threshold: narrow / regular / wide
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
- [`adr/README.md`](./adr/README.md): 확정·제안·대체된 아키텍처 결정
- [`atlas-industrial-violet.html`](./atlas-industrial-violet.html): Industrial + Signal Violet 레퍼런스
- [`../apps/web/README.md`](../apps/web/README.md): Web 앱 실행과 경계
- [`../apps/api/README.md`](../apps/api/README.md): API 앱 실행과 경계
