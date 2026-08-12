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
8. Locale/RTL, metadata/SEO, 오류 경계, 성능 예산과 Frontend 관측 기준을 통과한다.
9. 신규 route가 default-deny 권한 matrix에 자동 등록되고 미분류 route가 없음을 검증한다.
10. 별도 배포한 Docs에서 versioned 문법/API, 검증된 코드·화면 예제, 다운로드와 upgrade 안내를 재현한다.

필수 Gate는 모두 성공해야 한다. 인증·권한, secret, Migration 안전성, provenance와 artifact 무결성 Gate에는 waiver를 허용하지 않는다. 그 밖의 기존 실패는 위험 근거, 보상 통제, 소유자, 노출 환경과 만료일이 있는 명시적 waiver가 승인된 경우에만 한시적으로 허용하며 만료 시 자동으로 다시 차단한다.

모든 작업은 다음을 기록한다.

- 요구사항, 비요구사항, 공개 계약과 데이터 변경
- 가장 가까운 자동 검증과 실행 결과
- 환경 변수, 보안, 개인정보와 관측 영향
- DB 변경의 expand/backfill/contract, 호환성, 배포 순서와 roll-forward/restore
- 소비자 전환, deprecation과 breaking-change 영향

## 2. 현재 기준선

아래는 파일과 최근 검증을 기준으로 한 상태다. 전체 구현 완료를 의미하지 않는다.

| 영역               | 현재 상태                                                         | 먼저 해결할 항목                                   |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------- |
| Workspace/Lockfile | Root와 Web 중첩 workspace·lockfile 공존                           | Root 단일 workspace importer와 frozen install 복구 |
| Runtime/TypeScript | pnpm만 manifest에 고정, Node enforcement 없음, TS 메이저가 다름   | 지원 행렬과 runtime 파일·CI 확정                   |
| Turbo/Quality      | 일부 package script 없음, lint/format/build 기준선 실패           | task 참여 범위, read-only lint와 output 정리       |
| Repository hygiene | ignore 대상 API `dist` 일부가 추적됨                              | build artifact Source of Truth 결정                |
| Web                | Next.js 기본 scaffold                                             | 외부 font 재현성, data/auth/UI 적용                |
| API                | Nest scaffold와 env validation 일부 구현                          | 기존 config 검증 후 API 기반 확장                  |
| Shared packages    | `types/schemas` 일부, 나머지는 빈 export 중심                     | 계약·export·test와 외부 소비 검증                  |
| DB/Auth/UI         | 미착수                                                            | 아래 Gate와 Milestone 순서로 구현                  |
| Test/CI/Infra      | API unit 2개와 Root에 미포함된 E2E scaffold, 나머지는 placeholder | E2E compile 복구와 Milestone별 harness 구축        |
| Distribution       | 미정                                                              | package/template/version/update 모델 확정          |
| Docs Portal        | 저장소 내부 문서와 단일 HTML reference만 존재                     | 별도 앱, 예제 source, version/download 모델 확정   |

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
| 010 Identity/Authz     | User lifecycle, Role·ownership, default-deny와 revoke SLA                | IDC, M3 전에 필수                     |
| 011 Web Platform       | i18n, SEO/metadata, error, performance, Frontend observability           | WPF 전에 필수                         |
| 012 Documentation      | 정보 구조, versioning, example source, search와 artifact delivery        | DOC 전에 필수                         |

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
- Next/BFF는 승인 endpoint만 호출하고 임의 URL·identity header를 proxy하지 않으며 상태 변경 보안은 API와 동일하게 적용
- Production에서 알려진 placeholder, 동일 access/refresh key와 개발 DB credential 거절
- 최소 256-bit CSPRNG secret 생성, server-only 주입, rotation과 폐기 절차. Production은 승인된 provisioning workflow가 생성한 decoded 32-byte 이상 형식만 지원하고 수동 임의 secret을 받지 않는다.

### ADR-010 최소 결정

- User 상태 전이, email 재사용·정규화, Role과 ownership 모델
- 삭제·익명화·보존과 Session revoke, backup restore 이후 재적용 정책
- Global auth Guard, handler 단위 `@Public` 승인 allowlist, route inventory와 endpoint × role × ownership matrix
- `authzVersion` authoritative source/cache 정책, access TTL, 민감 endpoint 재검증과 모든 권한·Session 사건의 revoke 전파 SLA
- Service/Repository scope, mass assignment와 admin bootstrap 경계

### ADR-011 최소 결정

- 지원 locale, timezone, currency, `lang/dir`, translation fallback과 SSR/CSR 일치
- Metadata, canonical, robots, sitemap과 social preview 책임
- Not-found, expected/global/network error와 retry 경계
- WCAG 2.2 Level AA 자동·수동 검증 matrix
- JavaScript/CSS/route/font/image와 핵심 경로 성능 예산
- Web Vitals/Browser error 수집, sampling, PII allowlist와 release correlation

### ADR-012 최소 결정

- `apps/docs`의 별도 origin, hosting/CDN, 지원 버전과 `/latest` redirect 정책
- 저장소 내부 설계 문서와 공개 guide/reference/release content의 소유 경계
- Public type/export에서 reference를 생성·검증하는 방식과 example source의 실행 경계
- Preview sandbox/origin, 검색 index, analytics consent·PII와 외부 link 정책
- Release manifest schema, immutable artifact URL, checksum/provenance와 철회 UX
- Package/template publish, docs deploy, search indexing과 cache purge의 원자적 노출 순서

### ADR-009 최소 결정

- `@cornerstone/*` synchronized package release와 versioned template artifact
- Template이 고정할 package/runtime/schema compatibility manifest
- Local tarball·빈 소비자 검증과 registry publish 기준
- 생성 프로젝트 자동 overwrite 금지와 migration guide 정책
- Build 뒤 immutable staging digest를 고정하고 builder와 분리된 signer가 attest/sign한 뒤 별도 protected verifier가 pinned policy로 검증한 artifact만 publish/promote
- PR/release/deploy 신뢰 경계, OIDC 단기 자격증명과 protected environment

## 4. 소유권

최종 결정권자는 한 역할만 지정하고 협업·검토 역할과 분리한다.

| 계약/파일                                                   | 최종 결정권자    | 필수 협업·검토        |
| ----------------------------------------------------------- | ---------------- | --------------------- |
| Nest DTO, API 의미와 OpenAPI snapshot                       | Backend owner    | Frontend              |
| OpenAPI client codegen과 PR drift 검사                      | Backend owner    | Frontend, Release     |
| Transport-independent type/schema                           | Shared owner     | Frontend, Backend     |
| Frontend endpoint adapter와 Query hook                      | Frontend owner   | Backend               |
| Migration과 DB metadata                                     | Backend owner    | Operations            |
| UI token, public component API와 CSS entry                  | UI owner         | Frontend              |
| Root lockfile, compatibility manifest와 release metadata    | Release owner    | 각 package owner      |
| Identity lifecycle, route authorization matrix와 revoke SLA | Backend owner    | Security              |
| Next/BFF trust policy와 Web security header                 | Frontend owner   | Security, Operations  |
| Template source/archive, upgrade fixture와 migration guide  | Release owner    | 각 package owner      |
| Secret provisioning과 admin bootstrap                       | Operations owner | Security              |
| Docs 정보 구조, reference와 example acceptance              | Docs owner       | UI, Frontend, Backend |
| Release manifest와 artifact download metadata               | Release owner    | Docs, Security        |

OpenAPI, Migration, env schema, lockfile, generated artifact와 공용 token/type은 공유 계약 파일로 취급하며 동시에 수정하지 않는다. Release automation은 M4 codegen 결과가 최신인지 재검증하고 배포하며 생성 계약을 별도로 소유하지 않는다. Frontend/Backend 병렬 구현은 관련 snapshot, Cookie와 error code 계약이 고정된 뒤 시작한다.

## 5. Milestone

아래 경로와 명령은 현재 구현 상태가 아니라 해당 Milestone이 만들어야 할 필수 산출물이다. 각 Milestone은 Root에서 실행 가능한 검증 명령, 격리된 fixture, machine-readable 결과와 secret/PII가 제거된 실패 artifact를 함께 제공해야 하며 이 중 하나라도 없으면 완료로 판정하지 않는다. 명령명과 artifact 보존 위치는 M0의 ADR-006에서 고정하고 이후 단계가 임의의 별도 진입점을 만들지 않는다.

### M0. Baseline + Test/CI Kernel

목표:

- Root 단일 workspace와 lockfile을 복구하고 중첩 Web workspace의 처리 방식을 확정한다.
- Node `24.18.0`, pnpm `11.20.0`과 호환 TypeScript 단일 기준을 runtime 파일, `engines`와 CI에 적용한다.
- 추적 중인 build artifact, local dependency와 cache 정책을 정리한다.
- package별 Turbo task 참여·비참여, input/output과 environment를 정의한다.
- `lint`를 read-only로 만들고 `lint:fix`와 분리한다.
- Unit/component/integration/E2E Root 명령과 대상·제외 사유를 분리하고 API E2E compile을 복구한다.
- 최소 unit runner, smoke CI, PR secret scan과 release artifact 소비 harness를 준비한다.

검증:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

추가 검증:

- clean clone에서 prompt 없이 설치
- 추적 중인 dependency/cache/build output 없음
- Root test가 실제 대상과 제외 사유를 출력
- Root `test:e2e`가 API E2E와 향후 Playwright 대상에 연결됨
- Web 외부 font 의존성의 CI 재현 전략 검증
- fork PR이 secret 없이 최소 권한으로 smoke CI 실행
- Known test secret으로 scanner 동작을 검증하고 실제 repository/history secret은 0건

완료: 모든 필수 명령이 성공하고 승인되지 않은 기준선 실패와 중복 workspace·산출물이 없다.

### M1. Package Boundaries + Release Shape

목표:

- `types`, `schemas`, `utils`, `config`, `api-client`, `ui` 책임과 export map을 고정한다.
- Pure/server root와 browser subpath를 분리하고 deep import, 순환 의존과 앱 역의존을 차단한다.
- 기존 pagination, sort와 date 계약을 wire/runtime/UI-local 역할로 정리한다.
- 대표 pure utility와 `Result`를 test/type test와 함께 구현한다.
- ADR-002/009에 따라 package tarball과 template skeleton을 정의한다.
- `packages/ui`의 React peer 범위, server/browser/CSS export, CSS side effect와 SSR consumer contract를 고정한다.

검증:

- Unicode, 숫자 경계, timezone/DST, query encoding과 AbortSignal unit test
- Pure entry SSR import와 browser subpath test
- Export-surface/dependency test와 양 앱 production build
- `pnpm pack` tarball을 workspace link가 없는 임시 소비자에서 설치·typecheck·build
- 최소 Template을 생성해 `workspace:*`가 release version으로 해소되고 frozen install·build가 성공함

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

### WPF. Web Platform Foundation

진입 Gate: ADR-008의 지원 환경 matrix와 ADR-011 승인. UIF와 Backend 작업 중 독립 진행할 수 있으며 M6 전에 완료한다.

목표:

- Locale, timezone, currency, `lang/dir`, translation key와 fallback 계약을 구현한다.
- Metadata, canonical, robots, sitemap, social preview와 font/image 정책을 제공한다.
- Not-found, expected error, global error와 network/offline boundary를 분리한다.
- CSP nonce/hash, `frame-ancestors`, `nosniff`, Referrer/Permissions Policy와 운영 HSTS 책임을 정의한다.
- Web Vitals, Browser error, release/correlation context와 PII allowlist를 구성한다.
- Feature/package/Migration generator와 codegen/check 명령의 기본 형태를 만든다.

검증:

- Locale/timezone별 SSR HTML과 hydration 결과 일치
- `lang/dir`, RTL/CJK/긴 번역과 locale fallback
- Metadata/robots/sitemap snapshot과 404/500/error recovery E2E
- CSP 위반, framing, inline script, error response의 security header negative test
- WCAG 2.2 Level AA 자동 검사와 keyboard/screen reader 수동 matrix
- JavaScript/CSS/route/font/image와 핵심 사용자 경로의 승인된 성능 예산
- Browser telemetry에 query, form, token, Cookie와 PII 비노출

완료: 새 앱이 Domain 값만 주입해 국제화, metadata, 오류 처리, 보안 header, 접근성·성능·Frontend 관측 기준을 사용할 수 있다.

### M2. Network/API/Observability Foundation

진입 Gate: ADR-003/004/005 승인.

목표:

- 기존 API environment validation을 별도 검증하고 남은 bootstrap만 확장한다.
- API version, exact CORS, ValidationPipe, security header, payload limit와 graceful shutdown을 구성한다.
- Body/query/param/header/cookie별 unknown field, depth, count, string/array/page-size와 content-type 제한을 정의한다.
- 동적 sort/filter identifier는 enum에서 고정 column으로 mapping하고 값은 parameter binding한다.
- 표준 오류, request/correlation context, 구조화 log, metric, trace 연결과 OpenAPI를 제공한다.
- Log field allowlist와 redaction을 인증 구현 전에 적용한다.
- API integration/security harness를 함께 구축한다.

검증:

- env 누락, unknown field, 중복 query, 대용량 body와 잘못된 content type 거절
- Prototype key, 깊은 JSON, 대형 array/string, 복잡한 pattern과 SQL injection payload 거절
- 허용/거부/null/spoofed origin, preflight, `Vary: Origin`과 trusted proxy 경계
- token, Cookie, password, SQL/stack/PII가 response·log에 노출되지 않음
- 요청에서 API 오류까지 correlation ID와 HTTP metric 연결
- SIGTERM 시 readiness 하강, request drain과 정상 종료

완료: 모든 외부 요청이 같은 검증·보안·오류·관측 경계를 통과한다.

### IDC. Identity Data Contract

진입 Gate: ADR-005/010 승인. 첫 User/AuthSession Migration보다 먼저 완료한다.

목표:

- User 상태 전이, Role, ownership, email 정규화·재사용과 unique 의미를 고정한다.
- 삭제·익명화·보존과 Session revoke/cleanup 정책을 정의한다.
- ID, UTC timestamp, optimistic concurrency와 audit event 범위를 결정한다.
- `authzVersion` authoritative source, cache 최대 수명·무효화·장애 동작, access TTL과 logout/Session revoke/Role/status/password/permission/ownership/삭제의 revoke 전파 SLA를 고정한다.
- Backup restore 뒤 access JWT와 refresh/session을 각각 무효화한다. 복원 DB와 독립된 append-only 불변 저장소의 revoke·삭제·권한 변경 journal 재적용과 global auth epoch/key rotation 범위를 정한다.

검증: 상태 전이, email 재사용, 삭제·복원, Role 변경과 Session 기대 동작의 계약 test.

완료: M3가 추정 없이 index, 제약, relation과 Migration을 설계할 수 있다.

### M3. PostgreSQL + Migration Harness

진입 Gate: ADR-005/007/010과 IDC 완료.

목표:

- 개발/test DB를 분리하고 runtime과 CLI가 같은 설정 원천을 사용한다.
- User/AuthSession, normalization, index와 제약을 Migration으로 정의한다.
- Refresh 원문 대신 hash, family/generation, expiry/revoke와 cleanup metadata를 저장한다.
- 멱등 개발 Seed와 운영 one-time admin bootstrap을 분리한다.
- Migration integration harness와 metadata 형식을 만든다.
- `infra/compose`의 local/test PostgreSQL, connection env와 volume 격리를 제공한다.
- `infra/compose/compose.dev.yml`, `compose.test.yml`과 `apps/api/src/database/data-source.ts`를 기준 경로로 둔다.
- Migration은 `apps/api/src/database/migrations`, Seed는 `apps/api/src/database/seeds`가 소유하고 production `dist` 경로를 함께 검증한다.
- TypeORM/driver 의존성과 `migration:create/generate/run/revert/show`, `seed` Root/package script를 제공한다.
- Root의 `db:test:up/down`, `migration:run/revert/show`, `seed`를 CI와 local의 동일 진입점으로 제공한다.
- Migration/Seed 파일 naming, review, transaction과 production 실행 규칙을 문서화한다.

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
- 모든 환경에서 `synchronize=false`이고 앱 부팅 전후 승인되지 않은 schema diff나 DDL이 없음
- Entity 변경에 대응하는 Migration이 없으면 schema drift CI가 실패함

완료: 표준 Root 명령으로 local/test DB를 기동하고 Migration·Seed를 재현한다. M3에서는 PostgreSQL logical backup/restore만 검증하고 provider 기반 암호화 backup·restore는 M9에서 완료한다.

### M4. User Contract + OpenAPI Snapshot

목표:

- IDC의 User lifecycle, email, ID/UTC, 삭제·보존과 권한 계약을 DTO/API 의미에 반영한다.
- Request/Response DTO와 Mapper를 Entity에서 분리한다.
- versioned OpenAPI snapshot과 client artifact를 codegen하고 PR CI에서 생성 diff·contract drift를 차단한다.
- endpoint × role × ownership default-deny matrix를 확정한다.
- `role`, `status`, `passwordHash` mass assignment를 차단한다.
- Swagger bootstrap과 `apps/api/openapi/openapi.json` snapshot을 생성한다.
- Codegen config는 `packages/api-client/openapi.config.ts`, generated client는 `packages/api-client/src/generated`가 소유한다.
- `openapi:generate`, `openapi:check`, `client:generate`, `client:check` Root/package script를 제공한다.

이 단계는 공개 DTO와 authorization contract를 고정한다. 인증 principal이 필요한 보호 API의 최종 완료는 M5에서 수행한다.

검증: response contract, 날짜/오류/pagination, password 비노출과 forged field negative test.

완료: 소비자가 사용할 계약이 동결되고 breaking change가 자동 탐지된다.

### M5. Auth Backend Vertical Slice

목표:

- register, login, me, refresh, logout과 최소 인증 principal/guard를 구현한다.
- `APP_GUARD` 전역 인증을 적용하고 Controller-level `@Public`을 금지한다. Handler별 공개 사유·소유자·method가 승인 allowlist에 없거나 metadata가 없는 route를 거절한다.
- Refresh rotation, 경쟁, reuse revoke와 session cleanup을 transaction으로 처리한다.
- Cookie/CSRF/origin, rate limit, password hashing과 사용자 열거 방지를 구현한다.
- M4의 관리자/본인 API와 IDOR 방어를 인증 principal에 연결한다.
- Route inventory와 authorization matrix drift 검사, Service/Repository ownership scope를 구현한다.
- Access JWT의 session/authz version과 모든 권한·Session 사건의 revoke 전파 SLA를 적용한다. authz authoritative store/cache 장애 정책을 구현하고 민감 endpoint에서 현재 상태를 재검증한다.
- Admin bootstrap은 별도 단기 principal과 최소 DB 권한을 쓰는 protected one-off CLI/job으로 구현한다. Runtime image에서 bootstrap artifact를 제외하고 zero-admin DB lock, 감사, credential 폐기와 재실행 거절을 보장한다.
- Password는 Argon2id를 기본으로 환경 benchmark한 cost와 rehash 정책을 기록한다.
- Refresh token은 최소 256-bit CSPRNG, server-side hash/HMAC, constant-time 비교와 key rotation을 적용한다.
- Login과 권한 변경 시 session identifier를 재발급하고 auth Cookie는 특별한 호환 요구가 없으면 host-only `__Host-`를 기본으로 한다.

검증:

- 다른 algorithm/key/type/issuer/audience, 만료·미래 token 거절
- Cookie 발급·삭제 속성 일치와 모든 state-changing endpoint CSRF negative test
- 동시·다중 replica refresh에서 하나만 성공하고 reuse 시 family revoke
- 다중 replica에서 account/IP/session rate limit을 우회할 수 없고 proxy·시간 경계가 일관됨
- Logout, password/role/status 변경과 계정 삭제 후 기존 session 기대 동작
- anonymous, cross-user, 정지·삭제 사용자와 self role elevation 거절
- Guard/권한 metadata가 없는 신규 route와 matrix 미분류 route의 CI 실패
- Logout/Session revoke와 Role/status/password/permission/ownership/삭제가 SLA 안에 모든 replica에서 기존 access token과 refresh를 거절하고 authz store/cache 장애가 정해진 정책대로 동작
- Known JWT placeholder, 동일 access/refresh key, 승인된 provenance가 없거나 decoded 32-byte 미만인 secret과 개발 credential의 production startup 실패
- Admin bootstrap 동시·두 번째 실행 실패와 credential/artifact 비잔존
- Password cost/rehash, 낮은 entropy refresh, session fixation과 duplicate Cookie negative test
- transaction 실패 시 User/Session 부분 상태 없음
- `openapi:generate`와 `client:generate` 뒤 diff가 없고 global security, `@Public` 예외와 `401/403` 계약이 실제 Guard 동작과 일치함

완료: 인증·권한 matrix가 default-deny로 통과하고 강제 로그아웃 조건이 release 계약에 기록되며 `openapi:check`와 `client:check`가 통과한다.

### M6. Frontend SSR/Data/Auth Vertical Slice

진입 Gate: M4 OpenAPI/Cookie/error 계약과 UIF/WPF 완료.

목표:

- Browser, Server Component, Route Handler/BFF와 Server Action별 API 실행 계약을 정의한다.
- Request-scoped QueryClient와 server/browser API client를 분리한다.
- Refresh single-flight, form error, route protection과 redirect allowlist를 구현한다.
- 인증 fetch는 shared cache를 금지하고 허용된 Cookie/header만 전달한다.
- 상태 변경과 Session 권위는 Nest API에 유지하고 Next 경로는 승인된 endpoint adapter만 호출한다.
- API origin을 server-only 설정으로 고정하고 임의 URL proxy, Browser identity/forwarded header 전달과 자동 cross-origin redirect를 금지한다.

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
- Loopback/private/link-local/metadata, redirect/DNS 재해석과 forged identity header 요청 거절
- Route Handler/Server Action 상태 변경의 Origin/CSRF, rate limit, 권한과 audit 동등성

완료: 실행 컨텍스트별 인증과 cache 동작이 명시적이며 사용자 데이터가 요청 간 공유되지 않는다.

### M7. Core Product UI

목표:

- `AppShell`, `PageShell`, Sidebar, PageHeader와 Toolbar를 제공한다.
- Navigation, Form, Feedback, Dialog, Table/DataTable과 상태 화면을 구현한다.
- 인증, 설정, CRUD와 Dashboard reference를 공통 UI로 구성한다.
- 컴포넌트별 adaptive policy와 option taxonomy를 적용한다.
- Core v1 component inventory를 `UIF`, `M7`, `M7A`, 제외로 분류한 versioned release manifest로 고정한다.
- Reference route는 `/login`, `/settings/profile`, `/examples/resources`, `/dashboard`로 고정하고 각 route의 상태·필수 component·자동/수동 acceptance를 manifest에 연결한다.

검증:

- Viewport/container query, RTL, zoom, safe area와 virtual keyboard
- light/dark, Density와 대표 Style/Brand pairwise 조합
- loading/empty/error/disabled, keyboard와 screen reader
- DataTable scroll/column/card 정책을 소비자가 명시함
- Domain CSS 복사와 API 직접 의존 없음
- Release manifest에 선언되지 않은 Core component나 reference state가 있으면 CI 실패

완료: 네 reference 화면을 320px부터 넓은 viewport까지 정보·기능·focus 손실 없이 구성한다.

### M7A. Advanced UI

Core v1 Gate와 독립적으로 배포 가능한 후속 범위다.

- Chart, Sparkline, Tree, Timeline과 고급 data visualization
- DateRange/Time, FileUpload, Combobox/Autocomplete와 CommandPalette
- SplitPane, 복합 filter와 고급 DataTable pattern

각 컴포넌트는 public API, 접근성, responsive, SSR import, supported browser와 representative visual acceptance matrix를 충족해야 한다. FileUpload는 UI-only이며 server upload 보안을 제공한다고 간주하지 않는다.

### DOC. Documentation Portal + Examples

진입 Gate: ADR-002/008/009/011/012 승인과 M1/UIF/WPF 완료. Portal shell과 작성 도구는 먼저 진행할 수 있지만 Starter v1 공개 완료는 M7 Core inventory가 고정된 뒤 판정한다.

목표:

- `apps/docs`를 제품 앱과 분리해 build/deploy하고 version selector, navigation, search, mobile layout과 접근 가능한 code block을 제공한다.
- Getting Started, token/Appearance 문법, component·layout option API, Backend/Auth/Data, recipe와 운영 guide를 versioned content로 구성한다.
- `examples` source에서 코드 조각, interactive preview와 인증·설정·CRUD·Dashboard 예시 화면을 생성한다.
- 각 Component 페이지에 import, props/options, 기본값, 상태, responsive 지원 여부, 접근성, SSR/browser 제약, 관련 token과 migration을 표시한다.
- Release manifest에서 package/template 호환성, changelog, migration guide, checksum, provenance와 immutable download URL을 표시한다.
- Docs app, example preview, search index와 artifact storage/CDN의 배포·관측·보안 경계를 분리한다.

콘텐츠 검증:

- 모든 코드 예제의 format, lint, typecheck, build와 필요한 unit/E2E 실행
- Public export/type/token과 reference table의 누락·고아·deprecated link drift 검사
- Example 화면의 viewport, Theme/Style/Brand/Density, locale/RTL, keyboard/a11y와 visual regression
- 지원 version별 deep link, 이전/다음 release 전환, 404와 제거 API의 migration link
- Search 결과의 version 격리, keyboard navigation과 비공개/초안 content 미노출
- Copy code, anchor, source link, preview loading/error와 mobile navigation E2E

배포·다운로드 검증:

- Docs origin과 제품 Cookie/secret 비공유, CSP와 sandboxed preview의 script/frame/origin negative test
- Docs deploy principal에 artifact write 권한이 없고 upload principal에 Docs deploy 권한이 없음
- Release manifest의 version/digest/size/checksum/signature/provenance/runtime 정보와 실제 artifact 일치
- Mutable alias를 거치지 않은 immutable download, HTTPS, MIME, `Content-Disposition`, range/cache와 checksum 검증
- Publish 실패·철회·부분 배포 시 미완성 version 비노출, 대체 version 안내와 cache/search index 정합성
- Docs availability, Web Vitals, broken link, search/download 오류율과 release correlation 관측

완료: 사용자가 별도 Docs origin에서 지원 버전을 선택해 문법과 옵션을 이해하고, 검증된 코드·화면 예제를 확인하며, 호환되는 package/template을 무결성 정보와 함께 다운로드하고 upgrade할 수 있다.

### M8. Cross-layer Test Hardening

앞 단계에서 만든 harness를 새로 만드는 단계가 아니라 통합·강화한다.

목표:

- Auth/Role/Appearance/Migration 핵심 Playwright E2E를 완성한다.
- Locale/RTL/metadata/error recovery와 성능·접근성 budget E2E를 완성한다.
- DB worker 격리, fixture, clock, concurrency와 multi-replica scenario를 안정화한다.
- Flaky retry, coverage gap과 실패 artifact 보존 정책을 확정한다.
- Log, trace, screenshot, video와 `storageState`의 secret/PII를 제거한다.
- Login 실패, refresh reuse, Role/status 변경, admin bootstrap, key rotation과 publish/deploy security audit event를 검증한다.

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
build once → immutable staging digest → isolated attest/sign
→ protected verifier의 fail-closed 검증 → publish/promote
→ compatible migration → deploy → readiness → traffic
→ post-deploy verify → rollback window
→ 별도 승인 release에서 contract migration
```

필수 계약:

- Action SHA pinning, 최소 CI permission, fork PR secret 차단과 cache/artifact 격리
- OIDC 단기 자격증명, protected environment와 감사 가능한 승인
- Multi-stage/minimal image, base digest pin, non-root, read-only rootfs와 capability 제거
- Runtime/Migration/Deploy principal 분리, Migration timeout·동시 실행 차단
- 단기 Bootstrap principal과 protected-environment 승인, 최소 DB 권한, runtime image 내 bootstrap artifact 부재와 실행 후 credential 폐기
- HTTP/DB/Auth/Migration metric, deploy annotation과 readiness reason
- Publish/deploy/template install 전에 issuer, builder, repository/ref, subject digest와 manifest provenance를 검증
- Package namespace/trusted publishing/MFA, dependency lifecycle script와 cache provenance 정책
- Scan DB freshness, 차단 severity, 예외 승인·만료와 수정 SLA
- Backup 암호화/KMS, 별도 최소 권한, 불변성, checksum, audit, 보존·파기와 RPO/RTO
- 격리 restore 후 access JWT와 refresh/session을 각각 무효화하고 독립 append-only journal의 revoke·삭제·권한 변경을 재적용
- Contract Migration은 N-1 rollback window 종료, 이전 artifact 폐기 승인과 backup 검증 후 별도 실행
- JWT/registry/OIDC/signing/backup 침해 대응 runbook과 정기 drill
- Audit event의 접근권한, 무결성, 보존, alert threshold와 탐지·폐기 전파 SLA
- Traffic 전후 query 검증, abort 기준과 post-restore 보안 상태 검증
- Docs와 artifact storage/CDN을 별도 deployable로 배포하고 origin, principal, cache purge와 rollback을 분리

완료: 검증한 동일 digest가 승격되고 권한·artifact·Migration·rollback/restore 증거가 release에 보존된다.

### M10. Starter Distribution Rehearsal

목표:

- Package tarball, versioned template와 compatibility manifest를 release한다.
- README, changelog, migration guide와 운영 runbook을 실제 artifact에 맞춰 갱신한다.
- 별도 Docs release에서 해당 version의 reference, examples, download manifest와 search index를 공개한다.
- 임시 디렉터리에서 package/template 소비 전 과정을 리허설한다.

검증:

1. Template 생성과 frozen install
2. 자체 호스팅용 승인 명령으로 provenance가 있는 32-byte 이상 CSPRNG secret 생성과 운영 secret store 주입·rotation dry-run
3. Production placeholder/equal-key/default credential, 수동·형식 미달 secret 거절과 server-only env 확인
4. 별도 단기 principal로 protected one-time admin bootstrap을 실행하고 runtime image 비포함·credential 폐기·재실행 거절 확인
5. Cornerstone 이름, Domain, tracked/untracked secret과 기본 계정 잔존 검사
6. 빈 DB Migration/Seed와 Web/API 기동
7. 직전 release schema/data에서 upgrade, 구·신 앱 호환과 backfill 재시작
8. Contract 전 N-1 rollback과 contract 후 corrective roll-forward 경계를 구분해 검증
9. 직전 Template + 대표 사용자 변경 fixture에 package update와 migration guide 적용
10. 사용자 소유 파일 보존과 compatibility manifest 기준의 예상 diff 확인
11. Auth/Role/Appearance/Web Platform reference E2E
12. Production image 실행, readiness와 `snapshot → token 발급/revoke·사용자 삭제 → restore` 뒤 기존 access/refresh가 모두 거절되는 secure rollback/restore
13. Bundle, source map, image layer, log, trace와 fixture secret/PII scan
14. Release candidate의 immutable digest를 독립 signer/verifier가 fail-closed 검증한 뒤에만 최종 publish하고 compatibility manifest와 실행 log 보존
15. Docs의 version URL에서 manifest가 가리키는 artifact를 내려받아 checksum/provenance 검증 후 설치·build
16. Package/template publish 실패, Docs deploy 실패와 artifact 철회 각각에서 노출·cache·search·rollback 정합성 확인

완료: 구현자 도움 없이 별도 Docs에서 올바른 버전을 선택하고 새 프로젝트를 만들며 공통 package update와 template migration guide를 각각 적용할 수 있다.

## 6. 의존 순서

```text
M0 → M1 ─┬→ UIF ─────────────────────────┐
         ├→ WPF ─────────────────────────┤
         └→ M2 → IDC → M3 → M4 → M5 ────┼→ M6 → M7 → M8 → M9 → DOC → M10
                                          └────────────────────────────────┘

M7A는 M7 뒤 독립 release
```

- UIF는 M1과 ADR-008 지원 환경 matrix 뒤 Backend M2~M5와 병렬 진행할 수 있다.
- WPF는 ADR-011 뒤 진행하며 M6 전 완료한다.
- M2는 ADR-003/004/005 없이는 시작하지 않는다.
- IDC는 첫 Identity Migration 전에 완료하고 M3는 승인된 Identity/Session/Migration 계약만 구현한다.
- M6는 OpenAPI/Cookie/UIF/WPF 계약을 입력으로 받는다.
- DOC shell과 content tooling은 M1/UIF/WPF 뒤 병렬 진행할 수 있다. 최종 DOC Gate는 M7의 Core inventory와 M9의 별도 배포·신뢰 계약을 받아 M10 전에 완료한다.
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
| 신규 route 권한 누락             | Global Guard, route inventory와 matrix drift CI  |
| BFF/Server Action 보안 우회      | 승인 adapter와 API 동등 보안·SSRF negative test  |
| 알려진 secret/default credential | Production startup 거절과 provisioning rehearsal |
| Restore 후 권한·Session 부활     | Auth epoch/journal 재적용과 secure restore test  |
| i18n/SEO/성능/Frontend 관측 누락 | WPF 계약과 reference E2E·budget Gate             |
| 문서·코드·실제 API drift         | Typed example, export/reference와 version CI     |
| 잘못된/변조된 다운로드           | Immutable URL, checksum, provenance와 분리 권한  |
| Docs 부분 배포·버전 혼합         | Published manifest Gate, atomic 노출과 rollback  |

## 8. 다음 실행 범위

1. Root와 Web 중첩 workspace/lockfile의 소유 의도를 확인하고 Root 단일 기준을 복구한다.
2. ADR-001/002/006/008/009/011/012로 runtime, package, test, 지원 환경, distribution, Web Platform과 Docs 계약을 확정한다.
3. 추적 API `dist`, read-only lint, E2E TypeScript project와 Turbo task/output을 정리한다.
4. 기존 API environment 변경을 관련 unit test로 별도 마감한다.
5. M1 package export와 external-consumer harness를 구현한다.
6. ADR-003/004/005/010 승인 후 M2·IDC와 UIF/WPF를 병렬 시작한다.

Production provider가 미정이어도 M0~M8의 provider-independent 작업과 local artifact rehearsal은 진행할 수 있다. M9는 TLS, registry, secret, trust와 지원 환경을 ADR-008/009로 확정한 뒤 시작한다.
