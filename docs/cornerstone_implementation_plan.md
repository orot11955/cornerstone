# Cornerstone 구현 계획

> 설계 기준: [`cornerstone_assembly_diagram.md`](./cornerstone_assembly_diagram.md)
> 기준일: 2026-08-12

이 문서는 Cornerstone Starter v1의 현재 상태, 진입 Gate, 실행 순서와 검증 가능한 완료 조건을 관리한다. 영속적인 제품·아키텍처 계약은 설계 기준 문서에서 단일하게 정의한다.

## 1. Starter v1 완료 기준

Release artifact로 만든 새 프로젝트에서 다음을 구현자 도움 없이 재현해야 한다.

1. 지원 Node/pnpm 환경에서 frozen install과 Root 표준 명령을 통과한다.
2. 빈 PostgreSQL에 호환 Migration과 개발 Seed를 적용한다.
3. Web/API를 기동하고 회원가입, 로그인, 갱신, 로그아웃과 Role 접근 제어를 검증한다.
4. Theme, Style, Brand, Density를 변경하고 SSR 첫 화면과 새로고침 복구를 검증한다.
5. 공통 UI만으로 인증, 설정, CRUD와 Dashboard reference 화면을 반응형으로 구성한다.
6. Production image와 one-off Migration을 배포하고 readiness, traffic 전환과 rollback/restore 절차를 검증한다.
7. 공통 package tarball과 template archive, compatibility manifest, changelog와 migration guide를 생성한다.

필수 Gate는 모두 성공해야 한다. 기존 실패는 원인·소유자·기한이 있는 명시적 waiver가 승인된 경우에만 한시적으로 허용한다.

모든 작업은 다음을 기록한다.

- 요구사항, 비요구사항, 공개 계약과 데이터 변경
- 가장 가까운 자동 검증과 실행 결과
- 환경 변수, 보안, 개인정보와 관측 영향
- DB 변경의 expand/backfill/contract, 호환성, 배포 순서와 roll-forward/restore
- 소비자 전환, deprecation과 breaking-change 영향

## 2. 현재 기준선

아래는 파일과 최근 검증을 기준으로 한 상태다. 전체 구현 완료를 의미하지 않는다.

| 영역               | 현재 상태                                               | 먼저 해결할 항목                                   |
| ------------------ | ------------------------------------------------------- | -------------------------------------------------- |
| Workspace/Lockfile | Root와 Web 중첩 workspace·lockfile 공존                 | Root 단일 workspace importer와 frozen install 복구 |
| Runtime/TypeScript | Node/pnpm은 확인, TS 메이저가 Root/Web/API에서 다름     | 지원 행렬과 enforcement 파일 확정                  |
| Turbo/Quality      | 일부 package script 없음, lint/format/build 기준선 실패 | task 참여 범위, read-only lint와 output 정리       |
| Repository hygiene | ignore 대상 API `dist` 일부가 추적됨                    | build artifact Source of Truth 결정                |
| Web                | Next.js 기본 scaffold                                   | 외부 font 재현성, data/auth/UI 적용                |
| API                | Nest scaffold와 env validation 일부 구현                | 기존 config 검증 후 API 기반 확장                  |
| Shared packages    | `types/schemas` 일부, 나머지는 빈 export 중심           | 계약·export·test와 외부 소비 검증                  |
| DB/Auth/UI         | 미착수                                                  | 아래 Gate와 Milestone 순서로 구현                  |
| Test/CI/Infra      | 기본 API unit 외에는 placeholder 중심                   | Milestone별 harness와 smoke CI 구축                |
| Distribution       | 미정                                                    | package/template/version/update 모델 확정          |

현재 문서와 API config 관련 사용자 변경은 별도 논리 단위로 보존한다. 중첩 lockfile과 추적 산출물도 정책 확정 전에 임의 삭제하지 않는다.

## 3. ADR과 진입 Gate

| ADR                    | 결정할 계약                                                              | 완료되어야 하는 시점                  |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| 001 Runtime            | Node/pnpm/TypeScript 지원·고정·CI matrix                                 | M0                                    |
| 002 Package            | source export/build artifact, CSS, peer dependency, external consumption | M1                                    |
| 003 API                | Nest DTO/OpenAPI Source of Truth와 client 생성·drift 검증                | M2                                    |
| 004 Network            | Direct API/BFF, Browser·SSR 흐름, CORS, proxy와 cache                    | M2                                    |
| 005 Auth               | Cookie, CSRF, JWT/session, rotation/revoke/key transition                | M2, M3 전에 필수                      |
| 006 Test               | runner, DB 격리, fixture, clock와 artifact                               | M0                                    |
| 007 Migration/Release  | expand/backfill/contract, deploy와 restore                               | M3                                    |
| 008 Operations         | 지원 browser/OS/AT, TLS, hosting, secret, registry와 관측                | 지원 환경은 UIF 전, 운영 신뢰는 M9 전 |
| 009 Distribution/Trust | package+template release, SemVer, provenance와 update                    | M1, M9 전에 필수                      |

### ADR-003 최소 결정

- Endpoint 계약은 versioned OpenAPI가 단일 원천이다.
- `schemas`는 transport-independent primitive에 한정하고 DTO를 복제하지 않는다.
- OpenAPI snapshot, breaking-change diff, response contract test와 client artifact 소유자를 지정한다.
- `ErrorEnvelope`, auth/user endpoint, pagination/sort, 날짜/ID, `204/401/403/409` 의미를 고정한다.

### ADR-004/005 최소 결정

- Browser, Server Component, Route Handler/BFF와 API 사이 base URL·Cookie·cache 흐름
- Canonical origin, TLS 종료점, trusted proxy와 exact CORS allowlist
- Cookie별 name, host/domain, path, `Secure`, `HttpOnly`, `SameSite`, TTL과 삭제 속성
- 상태 변경 요청의 CSRF/Origin 검증과 null/spoofed origin 처리
- JWT algorithm, `iss/aud/typ`, `exp/nbf/iat`, clock skew, `kid`와 N/N-1 key overlap
- Refresh hash, family/generation, idle/absolute expiry, atomic consume와 reuse revoke
- Logout, password/role/status 변경과 계정 삭제 시 revoke 범위
- Rate limit 대상, account/IP/session key, trusted client IP, replica 간 state와 장애 시 동작

### ADR-009 최소 결정

- `@cornerstone/*` synchronized package release와 versioned template artifact
- Template이 고정할 package/runtime/schema compatibility manifest
- Local tarball·빈 소비자 검증과 registry publish 기준
- 생성 프로젝트 자동 overwrite 금지와 migration guide 정책
- Build once/promote same digest, immutable artifact, SBOM·provenance·서명 검증
- PR/release/deploy 신뢰 경계, OIDC 단기 자격증명과 protected environment

## 4. 소유권

| 계약/파일                                                | 단일 소유자          |
| -------------------------------------------------------- | -------------------- |
| Nest DTO, API 의미와 OpenAPI snapshot                    | Backend              |
| OpenAPI client codegen과 PR drift 검사                   | Backend/API owner    |
| Transport-independent type/schema                        | Shared package owner |
| Frontend endpoint adapter와 Query hook                   | Frontend             |
| Migration과 DB metadata                                  | Backend              |
| UI token, public component API와 CSS entry               | UI owner             |
| Root lockfile, compatibility manifest와 release metadata | Release owner        |

OpenAPI, Migration, env schema, lockfile, generated artifact와 공용 token/type은 공유 계약 파일로 취급하며 동시에 수정하지 않는다. Release automation은 M4 codegen 결과가 최신인지 재검증하고 배포하며 생성 계약을 별도로 소유하지 않는다. Frontend/Backend 병렬 구현은 관련 snapshot, Cookie와 error code 계약이 고정된 뒤 시작한다.

## 5. Milestone

### M0. Baseline + Test/CI Kernel

목표:

- Root 단일 workspace와 lockfile을 복구하고 중첩 Web workspace의 처리 방식을 확정한다.
- Node `24.18.0`, pnpm `11.20.0`과 호환 TypeScript 단일 기준을 enforcement 파일과 CI에 적용한다.
- 추적 중인 build artifact, local dependency와 cache 정책을 정리한다.
- package별 Turbo task 참여·비참여, input/output과 environment를 정의한다.
- `lint`를 read-only로 만들고 `lint:fix`와 분리한다.
- 최소 unit runner, smoke CI와 release artifact 소비 harness를 준비한다.

검증:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

추가 검증:

- clean clone에서 prompt 없이 설치
- 추적 중인 dependency/cache/build output 없음
- Root test가 실제 대상과 제외 사유를 출력
- Web 외부 font 의존성의 CI 재현 전략 검증
- fork PR이 secret 없이 최소 권한으로 smoke CI 실행

완료: 모든 필수 명령이 성공하고 승인되지 않은 기준선 실패와 중복 workspace·산출물이 없다.

### M1. Package Boundaries + Release Shape

목표:

- `types`, `schemas`, `utils`, `config`, `api-client`, `ui` 책임과 export map을 고정한다.
- Pure/server root와 browser subpath를 분리하고 deep import, 순환 의존과 앱 역의존을 차단한다.
- 기존 pagination, sort와 date 계약을 wire/runtime/UI-local 역할로 정리한다.
- 대표 pure utility와 `Result`를 test/type test와 함께 구현한다.
- ADR-002/009에 따라 package tarball과 template skeleton을 정의한다.

검증:

- Unicode, 숫자 경계, timezone/DST, query encoding과 AbortSignal unit test
- Pure entry SSR import와 browser subpath test
- Export-surface/dependency test와 양 앱 production build
- `pnpm pack` tarball을 workspace link가 없는 임시 소비자에서 설치·typecheck·build

완료: 빈 placeholder를 완료로 보지 않으며 공개 package가 외부 소비 형태로 재현된다.

### UIF. UI Foundation

M1 이후 Backend M2~M5와 병렬 진행할 수 있다. M6의 인증 화면보다 먼저 완료한다.

진입 Gate: ADR-008의 지원 browser/OS/보조기술, viewport, 입력 방식과 CI 실행 matrix 승인. Hosting·registry 등 운영 항목은 M9 전까지 확정할 수 있다.

목표:

- Foundation/Semantic/Component token과 Appearance SSR resolution을 구현한다.
- Breakpoint, container, layout, safe-area token과 `Responsive<T>`를 정의한다.
- `Box`, `Container`, `Stack`, `Inline`, `Grid`, Typography, focus와 portal 기반을 제공한다.
- Button, Input, FormField, selection, feedback와 기본 overlay를 구현한다.
- UI package CSS, React peer dependency와 server/browser export를 고정한다.

검증:

- SSR/hydration warning 0과 잘못된 Appearance 저장값 복구
- keyboard, focus, screen reader smoke, axe와 reduced motion
- 320/375/768/1024/1440px, 좁은 container, RTL과 긴 번역
- 200%·400% zoom, safe area, virtual keyboard와 Density 독립성
- 컴포넌트별 public API, state와 representative visual snapshot

완료: 인증·설정 form을 앱별 CSS 없이 구성하고 모든 지원 환경에서 의미·focus 순서를 보존한다.

### M2. Network/API/Observability Foundation

진입 Gate: ADR-003/004/005 승인.

목표:

- 기존 API environment validation을 별도 검증하고 남은 bootstrap만 확장한다.
- API version, exact CORS, ValidationPipe, security header, payload limit와 graceful shutdown을 구성한다.
- 표준 오류, request/correlation context, 구조화 log, metric, trace 연결과 OpenAPI를 제공한다.
- Log field allowlist와 redaction을 인증 구현 전에 적용한다.
- API integration/security harness를 함께 구축한다.

검증:

- env 누락, unknown field, 중복 query, 대용량 body와 잘못된 content type 거절
- 허용/거부/null/spoofed origin, preflight, `Vary: Origin`과 trusted proxy 경계
- token, Cookie, password, SQL/stack/PII가 response·log에 노출되지 않음
- 요청에서 API 오류까지 correlation ID와 HTTP metric 연결
- SIGTERM 시 readiness 하강, request drain과 정상 종료

완료: 모든 외부 요청이 같은 검증·보안·오류·관측 경계를 통과한다.

### M3. PostgreSQL + Migration Harness

진입 Gate: ADR-005/007 승인.

목표:

- 개발/test DB를 분리하고 runtime과 CLI가 같은 설정 원천을 사용한다.
- User/AuthSession, normalization, index와 제약을 Migration으로 정의한다.
- Refresh 원문 대신 hash, family/generation, expiry/revoke와 cleanup metadata를 저장한다.
- 멱등 개발 Seed와 운영 one-time admin bootstrap을 분리한다.
- Migration integration harness와 metadata 형식을 만든다.

Migration마다 기록:

- expand/backfill/contract 분류와 N/N-1 read/write 호환
- lock 위험, 예상 시간, abort 기준과 진행 관측
- backfill 멱등성·재시작, index/constraint validation 단계
- 동시 실행 방지와 앱 rollback 후 안전한 DB 상태

검증:

- 빈 DB `forward → revert → forward`
- 직전 release schema/data fixture에서 최신 schema로 upgrade
- Expand 단계에서 구·신 앱 artifact의 read/write 호환
- Backfill 중단·재시작과 중복 실행 멱등성
- Repository/transaction 성공·실패의 trace context, DB latency/error metric과 SQL parameter redaction
- Migration 동시성 차단과 production DB test 거부

완료: 개발 revert와 별개로 운영 corrective roll-forward·backup/restore 경로가 문서화되고 검증된다.

### M4. User Contract + OpenAPI Snapshot

목표:

- User 상태 전이, email normalization, ID/UTC, 삭제·익명화와 보존 정책을 정의한다.
- Request/Response DTO와 Mapper를 Entity에서 분리한다.
- versioned OpenAPI snapshot과 client artifact를 codegen하고 PR CI에서 생성 diff·contract drift를 차단한다.
- endpoint × role × ownership default-deny matrix를 확정한다.
- `role`, `status`, `passwordHash` mass assignment를 차단한다.

이 단계는 공개 DTO와 authorization contract를 고정한다. 인증 principal이 필요한 보호 API의 최종 완료는 M5에서 수행한다.

검증: response contract, 날짜/오류/pagination, password 비노출과 forged field negative test.

완료: 소비자가 사용할 계약이 동결되고 breaking change가 자동 탐지된다.

### M5. Auth Backend Vertical Slice

목표:

- register, login, me, refresh, logout과 최소 인증 principal/guard를 구현한다.
- Refresh rotation, 경쟁, reuse revoke와 session cleanup을 transaction으로 처리한다.
- Cookie/CSRF/origin, rate limit, password hashing과 사용자 열거 방지를 구현한다.
- M4의 관리자/본인 API와 IDOR 방어를 인증 principal에 연결한다.

검증:

- 다른 algorithm/key/type/issuer/audience, 만료·미래 token 거절
- Cookie 발급·삭제 속성 일치와 모든 state-changing endpoint CSRF negative test
- 동시·다중 replica refresh에서 하나만 성공하고 reuse 시 family revoke
- 다중 replica에서 account/IP/session rate limit을 우회할 수 없고 proxy·시간 경계가 일관됨
- Logout, password/role/status 변경과 계정 삭제 후 기존 session 기대 동작
- anonymous, cross-user, 정지·삭제 사용자와 self role elevation 거절
- transaction 실패 시 User/Session 부분 상태 없음

완료: 인증·권한 matrix가 default-deny로 통과하고 강제 로그아웃 조건이 release 계약에 기록된다.

### M6. Frontend SSR/Data/Auth Vertical Slice

진입 Gate: M4 OpenAPI/Cookie/error 계약과 UIF 완료.

목표:

- Browser, Server Component, Route Handler/BFF와 Server Action별 API 실행 계약을 정의한다.
- Request-scoped QueryClient와 server/browser API client를 분리한다.
- Refresh single-flight, form error, route protection과 redirect allowlist를 구현한다.
- 인증 fetch는 shared cache를 금지하고 허용된 Cookie/header만 전달한다.

실행 컨텍스트별로 기록:

- base URL과 credential 전달
- Cookie read/write와 `Set-Cookie` 책임
- refresh 수행 주체와 중복 방지
- Next fetch/cache/revalidate 정책
- dehydrate 대상과 민감 데이터 제외

검증:

- 사용자 A/B/anonymous의 response, Cookie와 Query cache 비혼합
- SSR/CSR 동시 만료와 여러 tab refresh
- 새로고침/direct navigation, 401/403과 refresh 실패
- open redirect, server action origin과 무한 redirect 방지
- password/token의 persistence·analytics·trace 비노출

완료: 실행 컨텍스트별 인증과 cache 동작이 명시적이며 사용자 데이터가 요청 간 공유되지 않는다.

### M7. Core Product UI

목표:

- `AppShell`, `PageShell`, Sidebar, PageHeader와 Toolbar를 제공한다.
- Navigation, Form, Feedback, Dialog, Table/DataTable과 상태 화면을 구현한다.
- 인증, 설정, CRUD와 Dashboard reference를 공통 UI로 구성한다.
- 컴포넌트별 adaptive policy와 option taxonomy를 적용한다.

검증:

- Viewport/container query, RTL, zoom, safe area와 virtual keyboard
- light/dark, Density와 대표 Style/Brand pairwise 조합
- loading/empty/error/disabled, keyboard와 screen reader
- DataTable scroll/column/card 정책을 소비자가 명시함
- Domain CSS 복사와 API 직접 의존 없음

완료: 네 reference 화면을 320px부터 넓은 viewport까지 정보·기능·focus 손실 없이 구성한다.

### M7A. Advanced UI

Core v1 Gate와 독립적으로 배포 가능한 후속 범위다.

- Chart, Sparkline, Tree, Timeline과 고급 data visualization
- DateRange/Time, FileUpload, Combobox/Autocomplete와 CommandPalette
- SplitPane, 복합 filter와 고급 DataTable pattern

각 컴포넌트는 public API, 접근성, responsive, SSR import, supported browser와 representative visual acceptance matrix를 충족해야 한다. FileUpload는 UI-only이며 server upload 보안을 제공한다고 간주하지 않는다.

### M8. Cross-layer Test Hardening

앞 단계에서 만든 harness를 새로 만드는 단계가 아니라 통합·강화한다.

목표:

- Auth/Role/Appearance/Migration 핵심 Playwright E2E를 완성한다.
- DB worker 격리, fixture, clock, concurrency와 multi-replica scenario를 안정화한다.
- Flaky retry, coverage gap과 실패 artifact 보존 정책을 확정한다.
- Log, trace, screenshot, video와 `storageState`의 secret/PII를 제거한다.

완료: 로컬/CI 명령이 같고 병렬 실행이 충돌하지 않으며 실패 artifact로 원인을 재현할 수 있다.

### M9. Production + Release Pipeline

진입 Gate: ADR-008/009 승인과 M3/M8 완료.

PR Gate:

```text
frozen install → format → lint → typecheck → unit/component
→ migration/integration → build → E2E → package/image scan
```

Release/Deploy:

```text
build once → SBOM/provenance/sign → immutable digest
→ compatible migration → deploy → readiness → traffic
→ post-deploy verify → contract migration
```

필수 계약:

- Action SHA pinning, 최소 CI permission, fork PR secret 차단과 cache/artifact 격리
- OIDC 단기 자격증명, protected environment와 감사 가능한 승인
- Multi-stage/minimal image, base digest pin, non-root, read-only rootfs와 capability 제거
- Runtime/Migration/Deploy principal 분리, Migration timeout·동시 실행 차단
- HTTP/DB/Auth/Migration metric, deploy annotation과 readiness reason
- Backup/restore rehearsal, traffic 전후 query 검증과 abort 기준

완료: 검증한 동일 digest가 승격되고 권한·artifact·Migration·rollback/restore 증거가 release에 보존된다.

### M10. Starter Distribution Rehearsal

목표:

- Package tarball, versioned template와 compatibility manifest를 release한다.
- README, changelog, migration guide와 운영 runbook을 실제 artifact에 맞춰 갱신한다.
- 임시 디렉터리에서 package/template 소비 전 과정을 리허설한다.

검증:

1. Template 생성과 frozen install
2. Cornerstone 이름, Domain, tracked/untracked secret과 기본 계정 잔존 검사
3. 빈 DB Migration/Seed와 Web/API 기동
4. 직전 release schema/data에서 upgrade, 구·신 앱 호환과 backfill 재시작
5. 직전 Template + 대표 사용자 변경 fixture에 package update와 migration guide 적용
6. 사용자 소유 파일 보존과 compatibility manifest 기준의 예상 diff 확인
7. Auth/Role/Appearance reference E2E
8. Production image 실행, readiness와 rollback/restore
9. Bundle, source map, image layer, log, trace와 fixture secret/PII scan
10. Tarball provenance, compatibility manifest와 실행 log 보존

완료: 구현자 도움 없이 새 프로젝트를 만들고 공통 package update와 template migration guide를 각각 적용할 수 있다.

## 6. 의존 순서

```text
M0 → M1 ─┬→ UIF ───────────────┐
         └→ M2 → M3 → M4 → M5 ├→ M6 → M7 → M8 → M9 → M10
                                └───────────────┘

M7A는 M7 뒤 독립 release
```

- UIF는 M1과 ADR-008 지원 환경 matrix 뒤 Backend M2~M5와 병렬 진행할 수 있다.
- M2는 ADR-003/004/005 없이는 시작하지 않는다.
- M3는 session/Migration 계약, M6는 OpenAPI/Cookie/UIF 계약을 입력으로 받는다.
- M9는 실제 DB·E2E 검증과 배포 신뢰 계약 없이는 시작하지 않는다.

## 7. 주요 위험과 대응

| 위험                             | 대응                                             |
| -------------------------------- | ------------------------------------------------ |
| 중첩 Workspace와 불완전 lockfile | M0에서 Root 단일 importer와 clean install 복구   |
| TypeScript/Framework 불일치      | ADR-001과 양 앱 clean build                      |
| Package가 workspace에서만 동작   | tarball external-consumer harness                |
| OpenAPI/schema/client drift      | snapshot, diff, contract test와 단일 생성 소유자 |
| Cookie/CSRF/CORS 경계 누락       | ADR-004/005와 origin matrix negative test        |
| Refresh 경쟁·reuse               | atomic rotation과 multi-replica integration test |
| SSR cache 사용자 데이터 누출     | context별 no-store/cookie 계약과 A/B 격리 test   |
| 비호환·장시간 Migration          | metadata, N/N-1, abort와 restore rehearsal       |
| UI 범위 폭증                     | UIF/Core/Advanced release 분리와 고정 inventory  |
| Log/test artifact의 secret·PII   | 중앙 redaction과 artifact scan                   |
| CI/image 공급망 변조             | immutable digest, SBOM, provenance, 서명과 OIDC  |
| Template 업그레이드 충돌         | 자동 overwrite 금지와 versioned migration guide  |

## 8. 다음 실행 범위

1. Root와 Web 중첩 workspace/lockfile의 소유 의도를 확인하고 Root 단일 기준을 복구한다.
2. ADR-001/002/006/009로 runtime, package, test와 distribution 계약을 확정한다.
3. 추적 API `dist`, read-only lint, E2E TypeScript project와 Turbo task/output을 정리한다.
4. 기존 API environment 변경을 관련 unit test로 별도 마감한다.
5. M1 package export와 external-consumer harness를 구현한다.
6. ADR-003/004/005 승인 후 M2와 UIF를 병렬 시작한다.

Production provider가 미정이어도 M0~M8의 provider-independent 작업과 local artifact rehearsal은 진행할 수 있다. M9는 TLS, registry, secret, trust와 지원 환경을 ADR-008/009로 확정한 뒤 시작한다.
