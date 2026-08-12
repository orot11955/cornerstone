# Cornerstone 구현 계획

> 설계 기준: [`cornerstone_assembly_diagram.md`](./cornerstone_assembly_diagram.md)
> 기준일: 2026-08-13

이 문서는 Cornerstone Starter v1의 현재 상태, 진입 Gate, 실행 순서와 검증 가능한 완료 조건을 관리한다. 영속적인 제품·아키텍처 계약은 설계 기준 문서에서 단일하게 정의한다.

## 1. Release 완료 기준

모든 기능을 하나의 Starter v1 완료 조건으로 묶지 않는다. [ADR-0017](./adr/0017-release-gates.md)에 따라 다음 Gate를 독립적으로 판정한다.

### Foundation Release

- 지원 Node/pnpm 환경에서 frozen install과 Root package 품질 명령 통과
- Shared package export, UI Foundation, SSR/browser 경계와 외부 소비 tarball 검증
- 생성 CLI가 사용자 manifest를 읽고 resolved lock manifest와 최소 Certified Profile을 재현
- 검증된 Foundation artifact와 일치하는 versioned package/API/UI stable Docs 제공

### Standard Starter Release

- 기본 `standard` Profile을 빈 디렉터리에 생성하고 선택하지 않은 capability가 남지 않음
- PostgreSQL Migration/Seed와 Web/API 기동
- 회원가입, 검증·복구, 로그인, 갱신, 로그아웃, Session 관리와 Role/ownership 검증
- Theme, Style, Brand, Density와 반응형 Core UI 검증
- `examples/reference-app`에서 인증, 설정, CRUD와 Dashboard reference 검증
- OpenAPI/client, default-deny route matrix와 local/CI E2E 통과

### Production Ready Release

- Mail, hosting, registry, secret store와 backup 등 필수 provider slot을 구체적인 지원 provider/version으로 해소
- `production` Profile의 image와 one-off Migration 배포, readiness, traffic 전환과 rollback/restore 검증
- Project가 선언한 SLI/SLO·capacity 값에 대한 load/soak와 alert/incident rehearsal
- Backup, secret/key rotation, SBOM/provenance/signing과 동일 digest 승격
- Stable Docs와 immutable package/template download 공개

### Regulated Profile Release

- Data classification, consent, export/delete, retention, residency, encryption과 audit 확장점 검증
- Project가 선언한 policy와 provider 제약을 machine-readable evidence로 보존
- 법적 준수를 보증하지 않고 적용 법률과 Domain 정책을 완성할 Foundation만 제공

### Extension Release

- 활성 capability별 port/adapter, provider config, local fake와 contract test 검증
- 독립 SemVer와 Core/Profile compatibility, deprecation, 장애 정책과 migration guide 제공
- 비활성 extension은 생성 코드, dependency, env와 인프라에 포함하지 않음

인증·권한, secret, Migration 안전성, provenance와 artifact 무결성처럼 활성 capability에 적용되는 필수 Gate에는 waiver를 허용하지 않는다. 입력 검증, secret scan, default-deny, build 재현성과 artifact integrity는 모든 Profile의 공통 Gate다. 그 밖의 기존 실패는 위험 근거, 보상 통제, 소유자, 노출 환경과 만료일이 있는 명시적 waiver가 승인된 경우에만 한시적으로 허용하며 만료 시 자동으로 다시 차단한다.

모든 작업은 다음을 기록한다.

- 요구사항, 비요구사항, 공개 계약과 데이터 변경
- 가장 가까운 자동 검증과 실행 결과
- 환경 변수, 보안, 개인정보와 관측 영향
- DB 변경의 expand/backfill/contract, 호환성, 배포 순서와 roll-forward/restore
- 소비자 전환, deprecation과 breaking-change 영향

## 2. 현재 기준선

아래는 파일과 최근 검증을 기준으로 한 상태다. 전체 구현 완료를 의미하지 않는다.

| 영역               | 현재 상태                                                                    | 먼저 해결할 항목                                                |
| ------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Workspace/Lockfile | Root 단일 workspace/lockfile, clean frozen install과 Node/pnpm/TS 고정       | Profile·DB 의존성 추가 때 동일 기준 유지                        |
| Turbo/Quality      | read-only format/lint, 명시적 test scope와 CI quality/security Gate 적용     | Milestone별 integration/Playwright 참여 승격                    |
| Repository hygiene | 추적 build/cache output 제거, Root artifact 경로와 package boundary 검사     | 이후 image/SBOM artifact 정책 연결                              |
| Shared packages    | M1 export/build/test/license 및 9개 tarball 외부 소비 검증 완료              | API/UI 공개 계약 추가 때 generated/export drift 검사            |
| Composition        | secret-free manifest/lock과 `minimal` Certified Profile 생성·검증            | dry-run/update journal과 standard/production/regulated fragment |
| UI Foundation      | token/Appearance/responsive Core component와 Web reference 구현              | 실제 browser hydration/axe/visual/AT matrix                     |
| Web Platform       | i18n/metadata/error/offline/CSP/telemetry/performance Gate 구현              | locale route 전략과 실제 browser/404/500/a11y E2E               |
| API Foundation     | prefix/CORS/validation/error/request context/log/metric/health/outbound 구현 | OpenAPI snapshot, DB idempotency와 shutdown drain integration   |
| DB/Auth            | 계약 전 단계이며 runtime 구현 미착수                                         | ADR-007/010과 IDC 뒤 PostgreSQL Migration부터 순차 구현         |
| Distribution       | package/generator tarball·license consumer 검증 완료                         | registry namespace/OIDC, signing/provenance와 immutable publish |
| Docs Portal        | 저장소 내부 ADR/계획과 HTML reference만 존재                                 | ADR-012, `apps/docs`, version/search/download 배포              |

현재 표의 “구현”은 해당 자동 검증이 존재한다는 뜻이며 release 완료를 뜻하지 않는다. UIF/WPF의 실제 browser·보조기술 검증, DXF의 상위 Profile, 외부 registry/hosting/protected branch와 Production provider는 아직 Gate가 열려 있다.

## 3. ADR과 진입 Gate

ADR 상태와 확정 원문은 [ADR Index](./adr/README.md)를 기준으로 한다. `Proposed` 항목은 아래 최소 결정만으로 승인된 것으로 간주하지 않는다.

| ADR                                                                | 상태     | 결정할 계약                                                              | 완료되어야 하는 시점      |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------ | ------------------------- |
| [001 Runtime](./adr/0001-runtime.md)                               | Accepted | Node/pnpm/TypeScript 지원·고정·CI matrix                                 | M0                        |
| [002 Package](./adr/0002-package-boundaries.md)                    | Accepted | source export/build artifact, CSS, peer dependency, external consumption | M1                        |
| [003 API](./adr/0003-api-contract.md)                              | Accepted | Nest DTO/OpenAPI Source of Truth와 client 생성·drift 검증                | M2                        |
| [004 Network](./adr/0004-network-boundary.md)                      | Accepted | Direct API/BFF, Browser·SSR 흐름, CORS, proxy와 cache                    | M2                        |
| [005 Auth](./adr/0005-auth-session.md)                             | Accepted | Cookie, CSRF, JWT/session, rotation/revoke/key transition                | M2, M3 전에 필수          |
| [006 Test](./adr/0006-test-kernel.md)                              | Accepted | runner, DB 격리, fixture, clock와 artifact                               | M0                        |
| 007 Migration/Release                                              | Proposed | expand/backfill/contract, deploy와 restore                               | M3                        |
| [008 Supported Environments](./adr/0008-supported-environments.md) | Accepted | 지원 browser/OS/AT와 responsive 검증 matrix                              | UIF 전                    |
| [009 Distribution/Trust](./adr/0009-distribution-trust.md)         | Accepted | package+template release, SemVer, provenance와 update                    | M1, M9 전에 필수          |
| [010 Identity/Authz](./adr/0010-identity-authorization.md)         | Accepted | User lifecycle, Role·ownership, default-deny와 revoke SLA                | IDC, M3 전에 필수         |
| [011 Web Platform](./adr/0011-web-platform.md)                     | Accepted | i18n, SEO/metadata, error, performance, Frontend observability           | WPF 전에 필수             |
| 012 Documentation                                                  | Proposed | 정보 구조, versioning, example source, search와 artifact delivery        | DOC 전에 필수             |
| 013 Data Governance                                                | Proposed | privacy, retention, encryption과 residency                               | Regulated Profile 전 필수 |
| 014 Extensions                                                     | Proposed | Redis/Queue/Realtime/OAuth/MFA/Mail/Storage port와 adapter               | EXT 전에 필수             |
| [015 Composition](./adr/0015-project-composition.md)               | Accepted | Canonical Template, capability manifest와 Certified Profile              | DXF 전 필수               |
| [016 Identity Scope](./adr/0016-identity-scope.md)                 | Accepted | Global identity 기반 single-tenant Core와 Tenant capability              | IDC/M3 전에 필수          |
| [017 Release Gates](./adr/0017-release-gates.md)                   | Accepted | Foundation, Standard, Production, Regulated와 Extension Gate             | 모든 release              |

### ADR-003 최소 결정

- Endpoint 계약은 versioned OpenAPI가 단일 원천이다.
- `schemas`는 transport-independent primitive에 한정하고 DTO를 복제하지 않는다.
- OpenAPI snapshot, breaking-change diff, response contract test와 client artifact 소유자를 지정한다.
- `ErrorEnvelope`, auth/user endpoint, pagination/sort, 날짜/ID, `204/401/403/409` 의미를 고정한다.
- Idempotency key scope/TTL/payload hash/replay, optimistic concurrency와 `409/412` 의미
- Timeout/cancel/retry 가능한 오류, backoff budget와 DB transaction/outbox side-effect 경계

### ADR-004/005 최소 결정

- Browser, Server Component, Route Handler/BFF와 API 사이 base URL·Cookie·cache 흐름
- Canonical origin, TLS 종료점, trusted proxy와 exact CORS allowlist
- Cookie별 name, host/domain, path, `Secure`, `HttpOnly`, `SameSite`, TTL과 삭제 속성
- 상태 변경 요청의 CSRF/Origin 검증과 null/spoofed origin 처리
- JWT algorithm, `iss/aud/typ`, `exp/nbf/iat`, clock skew, `kid`와 N/N-1 key overlap
- Refresh hash, family/generation, idle/absolute expiry, atomic consume와 reuse revoke
- Logout, password/role/status 변경과 계정 삭제 시 revoke 범위
- Email verification, forgot/reset/change password, recent-auth와 활성 Session 관리
- Verification/recovery token 목적, hash, single-use, expiry, attempt limit와 계정 열거 방지
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

### ADR-008 최소 결정

- 핵심 Web/API/Auth/DB/Docs/Download 및 활성 extension의 SLI·SLO, error budget와 release 중단 기준
- Alert severity, owner, 응답·escalation 시간과 상태 페이지/incident communication 책임
- Metric cardinality, log/trace retention·sampling, telemetry 비용과 개인정보 허용 범위
- Load/soak/burst profile, DB/HTTP pool, queue lag, memory와 graceful degradation 한계
- Provider별 RPO/RTO, region/residency, capacity와 비용 한도

### ADR-012 최소 결정

- `apps/docs`의 별도 origin, hosting/CDN, 지원 버전과 `/latest` redirect 정책
- 저장소 내부 설계 문서와 공개 guide/reference/release content의 소유 경계
- Public type/export에서 reference를 생성·검증하는 방식과 example source의 실행 경계
- Preview sandbox/origin, 검색 index, analytics consent·PII와 외부 link 정책
- Release manifest schema, immutable artifact URL, checksum/provenance와 철회 UX
- Package/template publish, docs deploy, search indexing과 cache purge의 원자적 노출 순서

### ADR-013 최소 결정

- Public/internal/confidential/restricted 데이터 분류와 log/trace/analytics/export/backup 허용 범위
- Access/export/correction/delete, consent·analytics opt-out와 Foundation/Domain 책임
- DB/cache/search/log/artifact/backup retention·삭제 전파, 증거와 법적 보존 예외
- Field encryption/tokenization, key rotation, index 제약과 region/residency enforcement

### ADR-014 최소 결정

- Redis, Queue/Scheduler, Realtime, OAuth/MFA, Mail과 Object Storage의 port, adapter와 package 경계
- Provider config/secret, local fake, health/readiness, telemetry와 장애 시 fail-fast/degrade 정책
- Queue delivery/DLQ, Realtime ordering/backpressure, identity linking/step-up와 upload quarantine 계약
- Extension별 version compatibility, contract test, supported provider와 deprecation 정책

### ADR-009 최소 결정

- Core `@cornerstone/*` synchronized package release, Extension 독립 SemVer, 생성 CLI와 versioned canonical template artifact
- Release manifest가 고정할 package/runtime/schema compatibility와 project lock schema
- Local tarball·빈 소비자 검증과 registry publish 기준
- 생성 프로젝트 자동 overwrite 금지와 migration guide 정책
- Build 뒤 immutable staging digest를 고정하고 builder와 분리된 signer가 attest/sign한 뒤 별도 protected verifier가 pinned policy로 검증한 artifact만 publish/promote
- PR/release/deploy 신뢰 경계, OIDC 단기 자격증명과 protected environment
- Root/package/template/example/docs의 license와 SPDX, `LICENSE`/`NOTICE`, attribution, 생성 프로젝트 license 선택과 dependency license policy
- `CODEOWNERS`, protected branch, required review/status check와 break-glass audit

## 4. 소유권

최종 결정권자는 한 역할만 지정하고 협업·검토 역할과 분리한다.

| 계약/파일                                                          | 최종 결정권자    | 필수 협업·검토        |
| ------------------------------------------------------------------ | ---------------- | --------------------- |
| Nest DTO, API 의미와 OpenAPI snapshot                              | Backend owner    | Frontend              |
| OpenAPI client codegen과 PR drift 검사                             | Backend owner    | Frontend, Release     |
| Transport-independent type/schema                                  | Shared owner     | Frontend, Backend     |
| Frontend endpoint adapter와 Query hook                             | Frontend owner   | Backend               |
| Migration과 DB metadata                                            | Backend owner    | Operations            |
| UI token, public component API와 CSS entry                         | UI owner         | Frontend              |
| Root lockfile, project lock manifest와 release metadata            | Release owner    | 각 package owner      |
| Capability manifest schema, preset, generator와 canonical template | Release owner    | 각 capability owner   |
| Identity lifecycle, route authorization matrix와 revoke SLA        | Backend owner    | Security              |
| Next/BFF trust policy와 Web security header                        | Frontend owner   | Security, Operations  |
| Template source/archive, upgrade fixture와 migration guide         | Release owner    | 각 package owner      |
| Secret provisioning과 admin bootstrap                              | Operations owner | Security              |
| Docs 정보 구조, reference와 example acceptance                     | Docs owner       | UI, Frontend, Backend |
| Release manifest와 artifact download metadata                      | Release owner    | Docs, Security        |
| Identity/Tenant scope와 privacy lifecycle                          | Backend owner    | Security, Data        |
| Optional port와 provider compatibility                             | Platform owner   | Backend, Frontend     |
| License/NOTICE와 dependency license policy                         | Release owner    | Legal/Compliance      |
| SLI/SLO, capacity와 alert policy                                   | Operations owner | Backend, Frontend     |

OpenAPI, Migration, env schema, lockfile, generated artifact와 공용 token/type은 공유 계약 파일로 취급하며 동시에 수정하지 않는다. Release automation은 M4 codegen 결과가 최신인지 재검증하고 배포하며 생성 계약을 별도로 소유하지 않는다. Frontend/Backend 병렬 구현은 관련 snapshot, Cookie와 error code 계약이 고정된 뒤 시작한다.

## 5. Milestone

아래 경로와 명령은 현재 구현 상태가 아니라 해당 Milestone이 만들어야 할 필수 산출물이다. 각 Milestone은 Root에서 실행 가능한 검증 명령, 격리된 fixture, machine-readable 결과와 secret/PII가 제거된 실패 artifact를 함께 제공해야 하며 이 중 하나라도 없으면 완료로 판정하지 않는다. 명령명과 artifact 보존 위치는 M0의 ADR-006에서 고정하고 이후 단계가 임의의 별도 진입점을 만들지 않는다.

### M0. Baseline + Test/CI Kernel

목표:

- Root 단일 workspace와 lockfile을 복구하고 중첩 Web workspace의 처리 방식을 확정한다.
- 저장소 개발·CI는 Node `24.18.0`, pnpm `11.20.0`으로 정확히 고정하고 package 소비자의 `engines.node` 지원 범위와 최소/기준 CI matrix를 별도로 결정한다.
- 추적 중인 build artifact, local dependency와 cache 정책을 정리한다.
- package별 Turbo task 참여·비참여, input/output과 environment를 정의한다.
- `lint`를 read-only로 만들고 `lint:fix`와 분리한다.
- Unit/component/integration/E2E Root 명령과 대상·제외 사유를 분리하고 API E2E compile을 복구한다.
- 최소 unit runner, smoke CI, PR secret scan과 release artifact 소비 harness를 준비한다.
- Cornerstone 저장소의 `CODEOWNERS`와 protected branch/required check 기준을 만들고 권한 matrix, Migration, lockfile와 release 계약의 필수 reviewer를 연결한다.

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
- 현재 `format:check` 13개 실패, API E2E `TS1259`, 수정형 API lint와 ts-jest module warning이 모두 해소됨
- 필수 계약 파일의 owner 없는 변경, review 우회와 만료된 break-glass 승인이 CI에서 거절됨

완료: 모든 필수 명령이 성공하고 승인되지 않은 기준선 실패와 중복 workspace·산출물이 없다.

### M1. Package Boundaries + Release Shape

목표:

- `types`, `schemas`, `utils`, `config`, `api-client`, `ui` 책임과 export map을 고정한다.
- Pure/server root와 browser subpath를 분리하고 deep import, 순환 의존과 앱 역의존을 차단한다.
- 기존 pagination, sort와 date 계약을 wire/runtime/UI-local 역할로 정리한다.
- 대표 pure utility와 `Result`를 test/type test와 함께 구현한다.
- ADR-002/009/015에 따라 package tarball, manifest schema와 canonical template skeleton을 정의한다.
- `packages/ui`의 React peer 범위, server/browser/CSS export, CSS side effect와 SSR consumer contract를 고정한다.
- Root/package/template/example/docs의 license/SPDX를 정렬하고 `LICENSE`, 필요한 `NOTICE`와 attribution을 artifact에 포함한다.

검증:

- Unicode, 숫자 경계, timezone/DST, query encoding과 AbortSignal unit test
- Pure entry SSR import와 browser subpath test
- Export-surface/dependency test와 양 앱 production build
- `pnpm pack` tarball을 workspace link가 없는 임시 소비자에서 설치·typecheck·build
- 최소 Certified Profile을 생성해 `workspace:*`가 release version으로 해소되고 frozen install·build가 성공함
- Dependency license allow/deny와 누락·충돌·금지 license scan

완료: 빈 placeholder를 완료로 보지 않으며 공개 package가 외부 소비 형태로 재현된다.

### DXF. Composition + Developer Experience

진입 Gate: M1과 [ADR-0015](./adr/0015-project-composition.md) 완료. Backend/UI 계약이 추가될 때 같은 manifest와 generator를 확장하며 Standard Starter 전에 완료한다.

목표:

- `packages/create-cornerstone`, `templates/canonical`, versioned `cornerstone.config.yml` schema와 `.cornerstone/manifest.lock.json` schema를 구현한다.
- 사용자 manifest에는 생성 의도만, lock manifest에는 normalized user manifest digest, resolved capability, exact generator/template/package version, schema baseline, compatibility와 적용한 template/fragment checksum만 기록한다. 두 파일에 secret·credential·개인정보 값을 허용하지 않는다.
- Lock manifest는 생성 프로젝트와 함께 version control에 포함하고 Generator만 갱신한다. 성공한 apply 뒤 atomic write하며 사용자 manifest digest가 다르거나 lock이 수동 변경되면 `verify`와 update를 중단한다.
- `minimal`, `standard`, `production`, `regulated` preset을 별도 Template 복제 없이 capability manifest로 해석한다. `production`은 필수 provider slot을 해소해야 생성 가능한 overlay로 취급한다.
- Interactive prompt와 `--manifest` non-interactive 실행이 같은 생성 plan을 사용한다.
- Capability dependency/conflict, 지원 수준, runtime/package/schema compatibility, 필수 provider 누락과 Production fake adapter를 생성 전에 검증한다.
- Starter v1은 동일 release manifest에 포함된 bundled capability만 실행하고 arbitrary remote plugin이나 신뢰하지 않은 Generator code를 실행하지 않는다. Extension runtime package는 독립 배포하되 초기 생성 fragment/composer는 호환 Core Generator release가 소유한다.
- 선택된 fragment만 적용하고 dependency, env example, compose/CI, Docs link와 project lock manifest를 함께 생성한다.
- `package.json`, env example, compose/CI, Nest module과 Next provider 같은 공유 파일은 파일별 단일 owner의 versioned structured composer가 소유한다. 적용 순서와 dependency/env/module/route 충돌 규칙을 schema로 고정하고 임의 text patch를 금지한다.
- Feature/package/API/Migration generator는 각 Milestone의 공개 경계와 naming을 재사용하고 생성 직후 format/typecheck/test가 가능한 결과를 만든다.
- 기존 프로젝트 변경은 `plan --dry-run`과 예상 diff를 먼저 제공하며 사용자 파일을 자동 overwrite하지 않는다.
- 신규 create는 staging directory에서 검증한 뒤 비어 있는 target으로 승격한다. 기존 update는 사전 계산한 change set, touched-file backup과 복구 journal을 사용하고 실패 시 복원하며 lock을 갱신하지 않는다.
- `verify` 명령은 lock manifest의 필수·금지 package/env/infra와 compatibility를 검사하되 사용자 소유 코드를 원본 Template과 동일하게 만들도록 강제하지 않는다.
- 생성 프로젝트의 제품 license는 manifest나 prompt에서 사용자가 선택하고, 미선택 시 임의 license를 부여하지 않는다. Cornerstone 재배포 파일의 필수 `NOTICE`와 attribution은 항상 보존한다.

검증:

- Certified Profile별 create → frozen install → typecheck/test/build와 필요한 Migration/E2E
- 같은 manifest/generator version의 byte-stable 생성 또는 승인된 non-determinism 목록
- 선택하지 않은 capability의 source/dependency/env/infra/Docs 잔존 0건
- 누락 dependency, conflict, Experimental 선택, schema/runtime 비호환과 Production fake adapter 거절
- 필수 provider 미해소, 공유 파일 composer 충돌, manifest/lock secret 값과 untrusted plugin 입력 거절
- 사용자 manifest/lock digest drift, lock 수동 변경과 실패한 apply의 lock 갱신 거절
- Windows/macOS/Linux path·권한·line ending과 archive traversal/symlink 안전성
- 사용자 수정 fixture의 dry-run 예상 diff와 취소 시 파일 변경 0건
- create 실패 시 target 변경 0건, update 중간 실패 시 touched file 복원과 lock 불변
- 선택 license와 Cornerstone `NOTICE`/attribution 결과 검증

완료: 사용자가 초기 설정 또는 manifest로 검증된 구성을 정의하고 선택된 기반만 재현 가능하게 생성한다. M1/UIF의 Foundation artifact와 Preview Docs가 일치하면 Foundation Release rehearsal을 실행할 수 있다.

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

현재 완료:

- `/api/v1`, exact Origin/CORS, JSON content type·1 MiB payload·query/body complexity와 strict DTO validation
- Helmet의 API security header, Cookie parser, explicit trust proxy, request/trace context와 표준 오류 envelope
- allowlist 구조화 log, bounded route/status metric, liveness/readiness와 shutdown readiness 전환
- fixed-origin outbound client의 redirect/timeout/cancel/response-size/circuit 경계
- idempotency key/canonical payload digest와 strong ETag의 결정적 primitive

남은 완료 조건:

- M4 DTO와 함께 versioned OpenAPI snapshot/client 생성 경로 연결
- M3 PostgreSQL transaction에서 idempotency reserve/replay/conflict와 outbox atomicity 구현
- SIGTERM 실제 process E2E에서 readiness 하강, in-flight drain와 timeout 검증
- outbound provider adapter의 승인 base URL fixture와 metric/trace 연결

목표:

- 기존 API environment validation을 별도 검증하고 남은 bootstrap만 확장한다.
- API version, exact CORS, ValidationPipe, security header, payload limit와 graceful shutdown을 구성한다.
- Body/query/param/header/cookie별 unknown field, depth, count, string/array/page-size와 content-type 제한을 정의한다.
- 동적 sort/filter identifier는 enum에서 고정 column으로 mapping하고 값은 parameter binding한다.
- 표준 오류, request/correlation context, 구조화 log, metric, trace 연결과 OpenAPI를 제공한다.
- Log field allowlist와 redaction을 인증 구현 전에 적용한다.
- API integration/security harness를 함께 구축한다.
- Idempotency key, optimistic concurrency, timeout/cancel/retry와 표준 outbound HTTP adapter 계약을 제공한다.

검증:

- env 누락, unknown field, 중복 query, 대용량 body와 잘못된 content type 거절
- Prototype key, 깊은 JSON, 대형 array/string, 복잡한 pattern과 SQL injection payload 거절
- 허용/거부/null/spoofed origin, preflight, `Vary: Origin`과 trusted proxy 경계
- token, Cookie, password, SQL/stack/PII가 response·log에 노출되지 않음
- 요청에서 API 오류까지 correlation ID와 HTTP metric 연결
- SIGTERM 시 readiness 하강, request drain과 정상 종료
- 동일 key/same payload replay, 동일 key/different payload 충돌, TTL 경계와 concurrent duplicate 요청
- `If-Match`/version 충돌, retry 금지 mutation, timeout/cancel과 outbound redirect/response-size/circuit 경계

완료: 모든 외부 요청이 같은 검증·보안·오류·관측 경계를 통과한다.

### IDC. Identity Data Contract

진입 Gate: ADR-005/010과 [ADR-0016](./adr/0016-identity-scope.md) 승인. 첫 User/AuthSession Migration보다 먼저 완료한다.

목표:

- User 상태 전이, Role, ownership, email 정규화·재사용과 unique 의미를 고정한다.
- 삭제·익명화·보존과 Session revoke/cleanup 정책을 정의한다.
- ID, UTC timestamp, optimistic concurrency와 audit event 범위를 결정한다.
- `authzVersion` authoritative source, cache 최대 수명·무효화·장애 동작, access TTL과 logout/Session revoke/Role/status/password/permission/ownership/삭제의 revoke 전파 SLA를 고정한다.
- Backup restore 뒤 access JWT와 refresh/session을 각각 무효화한다. 복원 DB와 독립된 append-only 불변 저장소의 revoke·삭제·권한 변경 journal 재적용과 global auth epoch/key rotation 범위를 정한다.
- Global User identity, global normalized email unique와 application-scoped Role/ownership을 계약에 고정한다.
- Tenant capability의 별도 schema baseline과 single-tenant Core에서 전환하는 Migration 경계를 기록한다.

검증: 상태 전이, email 재사용, 삭제·복원, Role 변경과 Session 기대 동작 및 single-tenant schema 계약 test.

완료: M3가 추정 없이 index, 제약, relation과 Migration을 설계할 수 있다.

### M3. PostgreSQL + Migration Harness

진입 Gate: ADR-005/007/010, [ADR-0016](./adr/0016-identity-scope.md)과 IDC 완료.

목표:

- 개발/test DB를 분리하고 runtime과 CLI가 같은 설정 원천을 사용한다.
- User/AuthSession, verification/recovery token, global email/Role/ownership, normalization, index와 제약을 Migration으로 정의한다.
- Refresh 원문 대신 hash, family/generation, expiry/revoke와 cleanup metadata를 저장한다.
- 멱등 개발 Seed와 운영 one-time admin bootstrap을 분리한다.
- Migration integration harness와 metadata 형식을 만든다.
- `infra/compose`의 local/test PostgreSQL, connection env와 volume 격리를 제공한다.
- `infra/compose/compose.dev.yml`, `compose.test.yml`과 `apps/api/src/database/data-source.ts`를 기준 경로로 둔다.
- Migration은 `apps/api/src/database/migrations`, Seed는 `apps/api/src/database/seeds`가 소유하고 production `dist` 경로를 함께 검증한다.
- TypeORM/driver 의존성과 `migration:create/generate/run/revert/show`, `seed` Root/package script를 제공한다.
- Root의 `db:test:up/down`, `migration:run/revert/show`, `seed`를 CI와 local의 동일 진입점으로 제공한다.
- Migration/Seed 파일 naming, review, transaction과 production 실행 규칙을 문서화한다.
- DB 상태와 외부 Mail/Queue side effect 사이에 transactional outbox 또는 승인된 동등 메커니즘을 제공한다.

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
- Outbox commit/rollback, duplicate delivery, worker crash/restart와 poison event 격리
- Single-tenant Core에 불필요한 `tenantId`/Membership schema와 암묵적 tenant filter가 없음

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
- Verify/resend verification, forgot/reset/change password, recent-auth와 active Session list/revoke 계약을 추가한다.
- Retry 가능한 mutation의 idempotency header, ETag/version과 `409/412/429` 계약을 OpenAPI에 고정한다.

이 단계는 공개 DTO와 authorization contract를 고정한다. 인증 principal이 필요한 보호 API의 최종 완료는 M5에서 수행한다.

검증: response contract, 날짜/오류/pagination, recovery enumeration, idempotency/concurrency, password/token 비노출과 forged field negative test.

완료: 소비자가 사용할 계약이 동결되고 breaking change가 자동 탐지된다.

### M5. Auth Backend Vertical Slice

목표:

- register, verify/resend verification, login, me, refresh, logout, forgot/reset/change password, recent-auth와 active Session list/revoke를 구현한다.
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
- Verification/recovery token은 purpose-bound hash, single-use, expiry와 attempt limit로 처리하고 성공 시 관련 Session/authz version을 원자적으로 revoke한다.
- Mail 전송은 outbox와 adapter를 사용하며 계정 존재 여부와 provider 상태를 외부 응답에 노출하지 않는다.

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
- Verification/reset token replay·purpose swap·expiry·brute force, resend flood와 존재/부재 계정 응답 동등성
- Password/email 복구 뒤 모든 기존 access/refresh 거절, recent-auth 만료와 Session 개별/전체 revoke
- Outbox/provider 실패·중복 전달에서도 User/token 상태와 메시지가 유실되거나 중복 효력을 만들지 않음
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
- Verify, forgot/reset/change password, recent-auth와 Session 관리 화면을 공통 Form/Feedback 컴포넌트로 구성한다.

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
- Verification/resend/reset deep link, 만료·재사용·offline/provider 지연, recent-auth와 Session revoke UX

완료: 실행 컨텍스트별 인증과 cache 동작이 명시적이며 사용자 데이터가 요청 간 공유되지 않는다.

### M7. Core Product UI

목표:

- `AppShell`, `PageShell`, Sidebar, PageHeader와 Toolbar를 제공한다.
- Navigation, Form, Feedback, Dialog, Table/DataTable과 상태 화면을 구현한다.
- 인증, 설정, CRUD와 Dashboard reference를 공통 UI로 구성한다.
- 컴포넌트별 adaptive policy와 option taxonomy를 적용한다.
- Core v1 component inventory를 `UIF`, `M7`, `M7A`, 제외로 분류한 versioned release manifest로 고정한다.
- `examples/reference-app`의 `/login`, `/settings/profile`, `/examples/resources`, `/dashboard` route와 각 상태·필수 component·자동/수동 acceptance를 manifest에 연결한다.

검증:

- Viewport/container query, RTL, zoom, safe area와 virtual keyboard
- light/dark, Density와 대표 Style/Brand pairwise 조합
- loading/empty/error/disabled, keyboard와 screen reader
- DataTable scroll/column/card 정책을 소비자가 명시함
- Domain CSS 복사와 API 직접 의존 없음
- Release manifest에 선언되지 않은 Core component나 reference state가 있으면 CI 실패

완료: 네 reference 화면을 320px부터 넓은 viewport까지 정보·기능·focus 손실 없이 구성한다. 기본 생성 프로젝트에는 `/examples/*`를 넣지 않고 `--examples` 선택에서만 포함한다.

### M7A. Advanced UI

Core v1 Gate와 독립적으로 배포 가능한 후속 범위다.

- Chart, Sparkline, Tree, Timeline과 고급 data visualization
- DateRange/Time, FileUpload, Combobox/Autocomplete와 CommandPalette
- SplitPane, 복합 filter와 고급 DataTable pattern

각 컴포넌트는 public API, 접근성, responsive, SSR import, supported browser와 representative visual acceptance matrix를 충족해야 한다. FileUpload는 UI-only이며 server upload 보안을 제공한다고 간주하지 않는다.

### EXT. Optional Platform Extensions

Core v1 Gate와 독립적으로 배포 가능한 후속 범위다. 진입 Gate는 ADR-014와 각 extension이 소비하는 Core 계약 완료다.

- `cache-redis`: namespace/TTL, stampede 방지, invalidation, outage와 multi-tenant key 격리
- `queue`/`scheduler`: durable enqueue, retry/backoff, deduplication, lease, DLQ, clock와 admin replay
- `realtime`: WebSocket/SSE 인증 갱신, reconnect/resume, ordering, backpressure와 quota
- `auth-oauth`/`auth-mfa`: account linking, provider trust, step-up, recovery와 factor/session revoke
- `tenant`: Tenant/Membership schema, route resolution, Role/ownership, cache/job/file/audit 격리와 Core 전환 Migration
- `mail`: message port adapter, sender/domain, template locale, bounce/complaint와 provider idempotency
- `storage`: upload policy, quarantine/malware scan, signed URL, metadata, lifecycle와 delete propagation

각 package는 provider SDK를 adapter 내부에 격리하고 config schema, local fake, contract test, health/readiness, metric, supported provider/version과 migration guide를 제공한다. Production에서 미설정 adapter를 in-memory 구현으로 자동 대체하지 않는다.

### DOC. Documentation Portal + Examples

Preview 진입 Gate: M1/DXF와 ADR-012 승인. Package/API/UI Milestone마다 같은 변경에서 example과 Preview Docs를 갱신한다. Stable Docs는 Foundation, Standard와 Production artifact가 각각 통과한 Gate까지만 공개한다.

목표:

- `apps/docs`를 제품 앱과 분리해 build/deploy하고 version selector, navigation, search, mobile layout과 접근 가능한 code block을 제공한다.
- Getting Started, token/Appearance 문법, component·layout option API, Backend/Auth/Data, recipe와 운영 guide를 versioned content로 구성한다.
- `examples` source에서 코드 조각, interactive preview와 인증·설정·CRUD·Dashboard 예시 화면을 생성한다.
- 각 Component 페이지에 import, props/options, 기본값, 상태, responsive 지원 여부, 접근성, SSR/browser 제약, 관련 token과 migration을 표시한다.
- Release manifest에서 package/template 호환성, changelog, migration guide, checksum, provenance와 immutable download URL을 표시한다.
- Docs app, example preview, search index와 artifact storage/CDN의 배포·관측·보안 경계를 분리한다.
- Account verification/recovery, Tenant capability 적용, privacy lifecycle, idempotency와 Optional extension 활성화 guide를 제공한다.

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

완료:

- Foundation stable: package/UI Foundation과 최소 Profile 문서가 Foundation artifact와 일치
- Standard stable: Core inventory, Auth/Data/API와 reference app 문서가 Standard artifact와 일치
- Production stable: M9 Gate와 M10 distribution rehearsal을 통과한 운영·복구·SLO·공급망 문서가 Production artifact와 일치
- Regulated/Extension stable: 활성 capability만 별도 compatibility와 함께 노출

### M8. Cross-layer Test Hardening

앞 단계에서 만든 harness를 새로 만드는 단계가 아니라 통합·강화한다.

공통 목표:

- DB worker 격리, fixture, clock, concurrency와 multi-replica scenario를 안정화한다.
- Flaky retry, coverage gap과 실패 artifact 보존 정책을 확정한다.
- Log, trace, screenshot, video와 `storageState`의 secret/PII를 제거한다.

Profile별 Gate:

- M8S Standard: Auth/Role/Appearance/Migration, Locale/RTL/metadata/error recovery와 성능·접근성 budget Playwright E2E를 완성한다.
- M8S Standard: Login 실패, refresh reuse, Role/status 변경, admin bootstrap과 key rotation을 검증한다.
- M8S Standard: Verification/recovery, recent-auth, Session revoke, idempotent mutation과 outbox crash/replay를 검증한다.
- M8P Production: M9가 만든 immutable candidate를 대상으로 승인된 load/soak/burst profile에서 SLI/SLO, pool/memory, graceful degradation, restore, publish/deploy security audit와 incident rehearsal을 검증한다.
- M8P Production: Metric cardinality와 log/trace retention·sampling budget을 machine-readable report로 검증한다.
- M8R Regulated: Data export/delete/retention 전파와 consent 변경의 audit·privacy fixture를 검증한다.
- M8E Extension: 활성 Tenant/Queue/Realtime/Mail/Storage 등 capability별 격리, 장애와 contract scenario를 검증한다.

완료: 모든 Gate는 로컬/CI 명령이 같고 병렬 실행이 충돌하지 않으며 실패 artifact로 원인을 재현할 수 있어야 한다. M8S가 통과하면 Standard Starter Release를 공개할 수 있고 M8P/M8R/M8E는 각각 Production, Regulated와 활성 Extension release만 차단한다.

### M9. Production + Release Pipeline

진입 Gate: ADR-008/009 승인과 M3/M8S 완료. M9가 immutable candidate와 검증 환경을 만든 뒤 M8P를 실행하고, Production publish와 M10 전에 통과시킨다.

PR Gate:

```text
frozen install → format → lint → typecheck → unit/component
→ migration/integration → build → E2E → package/image scan
```

Release/Deploy:

```text
build once → immutable staging digest → isolated attest/sign
→ protected verifier의 fail-closed 검증 → candidate 환경 배포
→ compatible migration → readiness → M8P 검증
→ 승인된 동일 digest publish/promote → production deploy → traffic
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
- Cornerstone release 저장소에 `CODEOWNERS`, protected branch, required review/status check와 break-glass 만료·사후 audit를 적용
- SLI/SLO dashboard, error budget release Gate, alert routing/on-call과 incident communication을 rehearsal
- Regulated Profile은 Data residency, encryption/key rotation, access/export/delete와 retention 전파 evidence를 release에 보존
- License/SPDX, `LICENSE`/`NOTICE`, attribution과 dependency license policy를 package/template/image/docs에 검증

완료: M8P가 검증한 동일 digest가 승격되고 권한·artifact·Migration·rollback/restore 증거가 release에 보존된다.

### M10. Production Distribution Rehearsal

목표:

- Package tarball, 생성 CLI, versioned canonical template와 release manifest를 공개한다.
- README, changelog, migration guide와 운영 runbook을 실제 artifact에 맞춰 갱신한다.
- 별도 Docs release에서 해당 version의 reference, examples, download manifest와 search index를 공개한다.
- 임시 디렉터리에서 package/template 소비 전 과정을 리허설한다.

검증:

1. Interactive 설정과 동일 사용자 manifest의 non-interactive 실행 결과 및 lock manifest가 일치하고 Certified Profile별 frozen install
2. 자체 호스팅용 승인 명령으로 provenance가 있는 32-byte 이상 CSPRNG secret 생성과 운영 secret store 주입·rotation dry-run
3. Production placeholder/equal-key/default credential, 수동·형식 미달 secret 거절과 server-only env 확인
4. 별도 단기 principal로 protected one-time admin bootstrap을 실행하고 runtime image 비포함·credential 폐기·재실행 거절 확인
5. 선택하지 않은 capability, Cornerstone 이름, Domain, tracked/untracked secret과 기본 계정 잔존 검사
6. 빈 DB Migration/Seed와 Web/API 기동
7. 직전 release schema/data에서 upgrade, 구·신 앱 호환과 backfill 재시작
8. Contract 전 N-1 rollback과 contract 후 corrective roll-forward 경계를 구분해 검증
9. 직전 생성 결과 + 대표 사용자 변경 fixture에 package update와 migration guide 적용
10. 사용자 소유 파일 보존과 project lock/release manifest 기준의 예상 diff 확인
11. Auth/Role/Appearance/Web Platform reference E2E
12. Production image 실행, readiness와 `snapshot → token 발급/revoke·사용자 삭제 → restore` 뒤 기존 access/refresh가 모두 거절되는 secure rollback/restore
13. Bundle, source map, image layer, log, trace와 fixture secret/PII scan
14. Release candidate의 immutable digest를 독립 signer/verifier가 fail-closed 검증한 뒤에만 최종 publish하고 release manifest와 실행 log 보존
15. Docs의 version URL에서 manifest가 가리키는 artifact를 내려받아 checksum/provenance 검증 후 설치·build
16. Package/template publish 실패, Docs deploy 실패와 artifact 철회 각각에서 노출·cache·search·rollback 정합성 확인
17. Package/template/example/docs의 license, `NOTICE`, attribution과 dependency license report 일치
18. Verification/reset/Session 관리와 idempotency E2E, 활성 Tenant/Regulated capability의 격리·privacy E2E
19. SLO·capacity report와 alert/incident rehearsal evidence 보존

완료: 구현자 도움 없이 별도 Docs에서 올바른 버전과 Profile을 선택하고 초기 설정/manifest로 필요한 capability만 가진 프로젝트를 생성하며 공통 package update와 template migration guide를 각각 적용할 수 있다.

## 6. 의존 순서

```text
M0 → M1 ─┬→ DXF ─────────────────────────┐
         ├→ UIF ─────────────────────────┤
         ├→ WPF ─────────────────────────┤
         └→ M2 → IDC → M3 → M4 → M5 ────┼→ M6 → M7 → M8S ─┬→ Standard
                                          └─────────────────┴→ M9 candidate → M8P → M10

Docs: M1/DXF → Preview
      M1/DXF/UIF → Foundation stable
      WPF/M2~M8S → Standard stable
      M9 candidate → M8P → M10 rehearsal/publish → Production stable

M7A는 M7 뒤 독립 release
M8R은 Regulated release, M8E는 활성 Extension release만 차단
EXT는 ADR-014와 필요한 Core 계약 뒤 독립 release
```

- UIF는 M1과 ADR-008 지원 환경 matrix 뒤 Backend M2~M5와 병렬 진행할 수 있다.
- WPF는 ADR-011 뒤 진행하며 M6 전 완료한다.
- DXF는 M1 뒤 시작하고 각 Backend/UI 계약을 capability fragment에 반영해 M6 전 기본 Certified Profile 생성을 완료한다.
- M2는 ADR-003/004/005 없이는 시작하지 않는다.
- IDC는 첫 Identity Migration 전에 완료하고 M3는 승인된 Identity/Session/Migration 계약만 구현한다.
- M6는 OpenAPI/Cookie/UIF/WPF/DXF 계약을 입력으로 받는다.
- DOC Preview는 M1/DXF 뒤 지속 배포하고 stable Docs는 각 Foundation/Standard/Production Gate의 검증된 artifact만 노출한다.
- EXT는 M1/M2와 extension별 M3/M5 계약 뒤 개별 진행하며 Core v1 완료를 차단하지 않는다.
- M9는 M8S의 실제 DB·E2E와 배포 신뢰 계약 없이는 시작하지 않는다. M9 candidate를 M8P가 검증하고 M10이 같은 digest를 publish한다.

## 7. 주요 위험과 대응

| 위험                             | 대응                                              |
| -------------------------------- | ------------------------------------------------- |
| 중첩 Workspace와 불완전 lockfile | M0에서 Root 단일 importer와 clean install 복구    |
| TypeScript/Framework 불일치      | ADR-001과 양 앱 clean build                       |
| Package가 workspace에서만 동작   | tarball external-consumer harness                 |
| OpenAPI/schema/client drift      | snapshot, diff, contract test와 단일 생성 소유자  |
| Cookie/CSRF/CORS 경계 누락       | ADR-004/005와 origin matrix negative test         |
| Refresh 경쟁·reuse               | atomic rotation과 multi-replica integration test  |
| SSR cache 사용자 데이터 누출     | context별 no-store/cookie 계약과 A/B 격리 test    |
| 비호환·장시간 Migration          | metadata, N/N-1, abort와 restore rehearsal        |
| UI 범위 폭증                     | UIF/Core/Advanced release 분리와 고정 inventory   |
| Log/test artifact의 secret·PII   | 중앙 redaction과 artifact scan                    |
| CI/image 공급망 변조             | immutable digest, SBOM, provenance, 서명과 OIDC   |
| Template 업그레이드 충돌         | 자동 overwrite 금지와 versioned migration guide   |
| 신규 route 권한 누락             | Global Guard, route inventory와 matrix drift CI   |
| BFF/Server Action 보안 우회      | 승인 adapter와 API 동등 보안·SSRF negative test   |
| 알려진 secret/default credential | Production startup 거절과 provisioning rehearsal  |
| Restore 후 권한·Session 부활     | Auth epoch/journal 재적용과 secure restore test   |
| i18n/SEO/성능/Frontend 관측 누락 | WPF 계약과 reference E2E·budget Gate              |
| 문서·코드·실제 API drift         | Typed example, export/reference와 version CI      |
| 잘못된/변조된 다운로드           | Immutable URL, checksum, provenance와 분리 권한   |
| Docs 부분 배포·버전 혼합         | Published manifest Gate, atomic 노출과 rollback   |
| 계정 복구 불가·token replay      | Purpose-bound single-use token과 Session revoke   |
| Tenant 도입 시 Identity 재설계   | ADR-0016과 별도 capability/Migration baseline     |
| 중복 mutation·side effect 유실   | Idempotency, concurrency와 transactional outbox   |
| License 충돌·재배포 불가         | SPDX/NOTICE와 dependency license Gate             |
| SLO 없는 관측·용량 고갈          | Error budget, load/soak와 cardinality/cost budget |
| 개인정보 삭제 전파 누락          | Data classification과 lifecycle evidence          |
| 문서상 owner 우회                | CODEOWNERS, protected branch와 required review    |
| Optional provider 결합           | Port/adapter, local fake와 contract test          |
| Capability 조합 폭증             | Certified Profile 우선과 지원 수준 명시           |
| Manifest와 생성 결과 drift       | Project lock manifest와 verify CI                 |
| 미선택 기능 잔존                 | Source/dependency/env/infra negative scan         |
| Manifest의 secret·의도/결과 혼합 | 사용자 config와 secret-free lock manifest 분리    |
| 공유 파일 fragment 충돌          | 단일 owner와 versioned structured composer        |
| 신뢰하지 않은 Generator 실행     | Release-bundled capability만 실행                 |
| Production provider 미해소       | 필수 provider slot과 exact Certified matrix       |

## 8. 다음 실행 범위

1. ADR-010 Identity/Authorization과 ADR-007 Migration/Release 계약을 확정하고 IDC를 완료한다.
2. M3 PostgreSQL/TypeORM, Migration/Seed/Outbox와 test DB isolation을 구현해 M2의 DB idempotency·readiness를 닫는다.
3. M4 OpenAPI snapshot/client codegen과 User 계약, M5 Auth/권한 backend를 순서대로 구현한다.
4. DXF structured composer와 `standard` Profile을 실제 M3~M5 capability로 확장한다.
5. UIF/WPF를 Playwright hydration/axe/viewport/RTL/404/500/security-header E2E 참여자로 승격한다.
6. M6 SSR/Data/Auth와 M7 Core Product UI/reference app 뒤 M8S Standard Gate를 실행한다.
7. ADR-012와 `apps/docs` Preview를 구현하고, Production 착수 전 Operations/Data Governance/Extension 계약과 외부 provider를 확정한다.

Production provider가 미정이어도 M0~M8의 provider-independent 작업과 local artifact rehearsal은 진행할 수 있다. M9는 TLS, registry, secret, trust와 지원 환경을 ADR-008/009로 확정한 뒤 시작한다.
