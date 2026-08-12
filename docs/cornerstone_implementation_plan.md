# Cornerstone 구현 계획서

> 기준 문서: [`cornerstone_assembly_diagram.md`](./cornerstone_assembly_diagram.md)  
> 기준일: 2026-08-12  
> 목적: 기존 구축 가이드를 실제 작업 단위, 선행 결정, 완료 조건, 검증 및 롤백 기준으로 구체화한다.

## 1. 문서 역할과 사용법

`cornerstone_assembly_diagram.md`는 목표 구조와 기술 예시를 설명하는 설계 가이드다. 이 문서는 그 가이드를 실행 가능한 백로그로 변환한 계획서다.

- 구현 순서와 범위는 이 계획서를 기준으로 한다.
- 코드 예시는 확정 계약이 아니다. 구현 시 설치된 라이브러리 버전과 공식 API를 확인한다.
- 각 작업은 한 가지 논리적 변경만 포함하고 독립적으로 검증 및 cherry-pick할 수 있게 한다.
- 각 Milestone 종료 시 코드, 테스트, 운영 문서가 함께 완료되어야 한다.
- 체크박스는 명령 실행과 결과 확인 후에만 갱신한다.

## 2. 제품 경계

### 2.1 Starter v1에 포함

- pnpm Workspace와 Turborepo 기반 Monorepo
- Next.js Web과 NestJS API
- 공통 TypeScript, ESLint, Prettier 규칙
- 환경 변수 검증과 안전한 비밀정보 취급
- PostgreSQL, TypeORM, Migration, Seed
- User, AuthSession, Cookie 기반 인증, Role 기반 인가
- 일관된 API 오류, 요청 추적, 구조화 로그, OpenAPI
- 공통 API Client, Query, Form, 인증 UI
- 재사용 가능한 UI 및 Appearance 체계
- Unit, Integration, E2E, 접근성 기본 검증
- 개발 Compose, Production Image, CI, 운영 문서

### 2.2 Starter v1에서 제외

- 프로젝트별 업무 Domain
- OAuth, 2FA, 메일 발송, Object Storage
- Queue, Scheduler, WebSocket, SSE
- Redis가 꼭 필요한 분산 세션 또는 캐시
- 조직·테넌트 기반 복합 Permission
- Kubernetes나 특정 Cloud에 종속된 배포 구성
- 실제 사용 사례로 검증되지 않은 범용 추상화

### 2.3 성공 기준

새 저장소에서 다음 시나리오가 별도 구조 변경 없이 동작해야 한다.

1. 문서대로 의존성과 개발 인프라를 준비한다.
2. Root에서 Web과 API를 함께 실행한다.
3. 빈 DB에 Migration과 개발 Seed를 적용한다.
4. 회원가입, 로그인, 인증 확인, 토큰 갱신, 로그아웃을 수행한다.
5. 보호된 화면과 관리자 API의 접근 제어를 확인한다.
6. Theme, Brand, Style, Density를 바꾸고 새로고침 후 유지 여부를 확인한다.
7. Root 표준 명령과 CI 검증을 통과한다.
8. Production Image를 만들고 Migration 후 readiness를 통과한다.

## 3. 현재 저장소 기준선

아래 상태는 파일 존재와 구성 내용을 기준으로 한 정적 판단이다. 실행 검증 완료를 의미하지 않는다.

| 영역               | 상태      | 근거                                       | 다음 조치                                    |
| ------------------ | --------- | ------------------------------------------ | -------------------------------------------- |
| Workspace          | 진행      | `pnpm-workspace.yaml`, Root `package.json` | 중복 lockfile 및 패키지 경계 정리            |
| Web                | 뼈대 완료 | `apps/web` Next.js 기본 앱                 | 공통 설정, 테스트, 실제 App 구조 적용        |
| API                | 뼈대 완료 | `apps/api` NestJS 기본 앱                  | Bootstrap과 기반 모듈 확장                   |
| Turborepo          | 진행      | `turbo.json`                               | 환경 입력, task output, CI용 task 검증       |
| TypeScript         | 진행      | `packages/tsconfig`                        | Web/Nest별 필수 옵션과 패키지 typecheck 확정 |
| Shared packages    | 뼈대 완료 | `packages/*`                               | 책임·의존 방향·빌드 전략 확정                |
| Environment config | 작업 중   | `apps/api/src/config`, `.env.example`      | 기존 사용자 변경을 보존하여 검증 후 완료     |
| Database           | 미착수    | `infra/compose`와 DB 코드 없음             | PostgreSQL부터 순차 구현                     |
| Auth/UI/Test/CI    | 미착수    | 관련 구현 없음                             | 후속 Milestone 진행                          |

현재 사용자 작업으로 보이는 `apps/api/package.json`, `apps/api/src/config/*`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `packages/schemas/src/index.ts`, `pnpm-lock.yaml` 변경은 별도 작업으로 취급한다. 다음 단계에서 임의로 덮어쓰거나 함께 정리하지 않는다.

## 4. 구현 전에 확정할 의사결정

다음 항목은 뒤 단계의 계약을 바꾸므로 해당 Milestone 시작 전에 ADR(Architecture Decision Record)로 확정한다.

### ADR-001 런타임과 버전 정책

- Node.js 지원 버전과 CI 버전을 하나로 고정한다.
- Root의 `packageManager`를 단일 기준으로 사용하고 하위 Workspace의 별도 lockfile과 workspace 파일은 제거 여부를 검토한다.
- 주요 프레임워크는 lockfile로 재현하고, Starter release마다 지원 버전을 문서화한다.
- TypeScript 메이저 버전은 Web, API, shared package가 실제로 함께 지원하는 버전으로 통일한다.

완료 조건:

- [ ] `.nvmrc`, `.node-version` 또는 `engines.node` 중 하나의 기준 존재
- [ ] Root lockfile 하나만 설치 기준으로 사용
- [ ] `pnpm install --frozen-lockfile` 성공

### ADR-002 Shared package 배포 방식

다음 중 하나를 선택한다.

- Source export: 앱의 bundler가 `packages/*/src`를 직접 transpile한다.
- Build artifact: 각 package가 `dist`와 declaration을 만들고 앱은 산출물을 소비한다.

Starter v1 권장안은 source export다. 단, Next의 `transpilePackages`, Nest의 Node module 해석, 테스트 러너의 변환 범위를 함께 검증해야 한다. 외부 npm 배포가 필요해질 때 build artifact 방식으로 전환한다.

의존 방향:

```text
apps/web ─┬─> api-client ─> types/schemas
          └─> ui ─────────> types/utils

apps/api ───> types/schemas/utils/config

types, schemas, utils, config는 apps 또는 ui에 의존하지 않는다.
```

완료 조건:

- [ ] package별 책임과 허용 의존성 문서화
- [ ] 순환 의존성 없음
- [ ] package별 `typecheck`와 필요한 `build` script 존재
- [ ] 앱의 개발 및 production build에서 import 검증

### ADR-003 API 계약의 단일 Source of Truth

Starter v1에서는 OpenAPI를 서버 계약의 기준으로 사용한다.

- Nest DTO와 Swagger metadata에서 OpenAPI를 생성한다.
- Entity를 응답 계약으로 노출하지 않는다.
- 날짜는 JSON에서 ISO 8601 UTC 문자열로 표현한다. TypeScript 응답 타입도 `Date`가 아니라 `string`으로 둔다.
- Generated client는 Starter v1 이후 후보로 두되, 그 전에는 `api-client`의 수동 타입과 OpenAPI 간 계약 테스트를 둔다.

### ADR-004 브라우저와 API 연결 방식

다음을 명확히 선택한다.

- 기본안: 브라우저가 별도 origin의 Nest API를 직접 호출한다.
- 대안: Next Route Handler를 BFF로 사용한다.

기본안을 선택하면 개발/운영 origin, CORS allowlist, Cookie domain/path, SSR 요청 시 Cookie 전달 방법을 정의해야 한다. 두 방식을 화면마다 혼합하지 않는다.

### ADR-005 인증과 CSRF 전략

브라우저 기본 인증은 HttpOnly Cookie로 하되 아래 계약을 함께 확정한다.

- access/refresh Cookie 이름, `Path`, `Domain`, `Secure`, `SameSite`, TTL
- 개발 HTTP와 운영 HTTPS의 차이
- 상태 변경 요청의 CSRF 방어: SameSite만으로 충분한 배치인지, Origin/Referer 검사와 CSRF token을 추가할지
- 동시 refresh 요청 처리와 token reuse 감지 정책
- 전체 기기 로그아웃과 단일 세션 로그아웃 범위

권장 기본값:

- access token은 짧은 수명, refresh token은 rotation하는 HttpOnly Cookie
- refresh Cookie는 refresh endpoint로 `Path`를 제한
- 운영 환경은 `Secure=true`
- 상태 변경 요청은 strict origin allowlist를 검사
- refresh token 원문과 password를 로그 또는 DB에 저장하지 않음

### ADR-006 테스트 러너

현재 API scaffold는 Jest를 사용한다. 기존 가이드의 Backend 예제에는 `vi.fn()`이 있어 Vitest와 충돌한다.

- API: Jest 유지 및 `jest.fn()` 사용
- Web/shared UI: Vitest 사용
- E2E: Playwright 사용

러너를 통일하려는 별도 근거가 생기기 전에는 위 조합을 기본으로 한다.

### ADR-007 배포와 Migration 순서

배포 기본 순서는 다음으로 수정한다.

```text
Build/Test → Image Push → 사전 호환 Migration → 새 버전 Deploy
→ Readiness 확인 → Traffic 전환 → 사후 정리 Migration
```

- 스키마 변경은 expand → migrate/backfill → contract를 기본으로 한다.
- 앱 배포와 호환되지 않는 destructive migration은 한 번에 실행하지 않는다.
- rollback은 앱 rollback과 DB roll-forward/rollback 가능성을 각각 판단한다.

### ADR-008 운영 환경과 지원 범위

현재 저장소에는 CI provider, hosting platform, reverse proxy, domain, secrets manager가 정해져 있지 않다. Production 구현 전에 다음을 확정한다.

- Web/API의 동일 site 여부와 TLS 종료 지점
- container runtime과 image registry
- secret 주입 및 rotation 주체
- migration one-off job 실행 주체와 동시 실행 방지
- log/metric 보관 위치와 개인정보 보존 기간
- 지원 브라우저, 운영체제, PostgreSQL 버전

특정 provider가 정해지기 전에는 표준 Docker image와 환경 변수 계약까지만 Core로 구현하고 provider 전용 manifest는 별도 adapter로 둔다.

## 5. 공통 작업 완료 기준

모든 작업은 다음을 만족해야 완료로 본다.

- [ ] 요구사항과 비요구사항이 작업 설명에 명시됨
- [ ] 공개 계약 또는 데이터 변경 여부가 기록됨
- [ ] 관련 테스트가 추가되거나 불필요한 이유가 기록됨
- [ ] 가장 가까운 lint, typecheck, test, build가 실행됨
- [ ] 실패 시 기존 실패와 신규 실패가 구분됨
- [ ] 환경 변수 또는 운영 절차 변경 시 `.env.example`과 문서가 함께 갱신됨
- [ ] DB 변경 시 forward, data transform, compatibility, deploy order, rollback이 기록됨
- [ ] 인증·사용자 데이터 변경 시 보안 검토 항목이 확인됨
- [ ] `git diff`와 `git status`로 기존 사용자 변경과 작업 변경이 분리됨
- [ ] 커밋한다면 한 논리 단위이며 명시적인 사용자 요청이 있을 때만 수행함

## 6. 상세 Milestone 계획

## Milestone 0. 기준선 안정화

목표: 이후 기능이 재현 가능한 공통 기반 위에서 개발되도록 한다.

### M0-1 저장소 위생

- Root `.gitignore`가 모든 Workspace의 dependencies, build output, cache, local env를 처리하는지 검증한다.
- 이미 추적 중인 `node_modules`, `.next`, `dist`가 없는지 확인한다.
- `apps/web/pnpm-lock.yaml`, `apps/web/pnpm-workspace.yaml`의 필요성을 검토하고 Root 단일 Workspace 원칙과 충돌하면 별도 변경으로 제거한다.
- Root `README.md`에 설치, 실행, 검증 명령을 추가한다.

### M0-2 Toolchain 고정

- ADR-001을 작성한다.
- Node와 pnpm 버전을 고정한다.
- package script의 들여쓰기와 이름을 통일한다.
- CI용 `lint`는 파일을 수정하지 않게 하고, `lint:fix`를 별도로 둔다. 현재 API의 `eslint ... --fix`는 CI에 그대로 사용하지 않는다.

### M0-3 Monorepo task 계약

- 모든 적용 대상 package에 `lint`, `typecheck`, `test`, `build` 중 필요한 script를 명시한다.
- Turbo task의 `inputs`, 환경 변수, output을 정의한다.
- `.env` 값이나 비밀정보가 remote cache key 또는 log에 노출되지 않게 한다.
- 개발 task가 종료되지 않는 persistent task임을 확인한다.

검증:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

완료 조건:

- [ ] 새 clone 기준 설치 재현
- [ ] Root 표준 명령의 의미와 대상 명확
- [ ] 추적 중인 dependency/build 산출물 없음
- [ ] 기준선 실패가 있다면 문서에 원인과 소유자 기록

## Milestone 1. Workspace와 공통 패키지

목표: 앱과 package 사이 계약과 의존 방향을 안정화한다.

### M1-1 TypeScript config

- `base`, `node`, `nest`, `react` 설정의 target, module, resolution, lib, declaration 정책을 확정한다.
- Next와 Nest의 실제 build 설정을 덮어쓰지 않는지 확인한다.
- shared package가 사용하는 Node/DOM type 범위를 분리한다.

### M1-2 ESLint config

- 빈 `@cornerstone/eslint-config`를 실제 flat config로 구현한다.
- base, node/nest, react/next preset을 분리한다.
- import boundary와 unused import 정책을 정한다.
- format은 Prettier, correctness는 ESLint가 담당하도록 중복 규칙을 줄인다.

### M1-3 Shared package 책임

| Package      | 책임                              | 포함 금지                               |
| ------------ | --------------------------------- | --------------------------------------- |
| `types`      | 직렬화 가능한 공통 타입           | Entity, React type, 특정 Domain         |
| `schemas`    | 런타임 입력 검증과 추론 타입      | DB 접근, UI 상태                        |
| `utils`      | 환경 독립 pure utility            | 앱 설정, network client                 |
| `config`     | 공유 가능한 상수/설정 schema      | secret 값, process-global mutable state |
| `api-client` | HTTP, 오류 변환, endpoint adapter | UI component, auth 화면 상태            |
| `ui`         | token, primitive, composite UI    | 업무 Domain, API 직접 호출              |

완료 조건:

- [ ] 모든 package import 경로가 앱 dev/build/test에서 동작
- [ ] public export만 소비하고 내부 경로 import를 금지
- [ ] 공통 pagination의 page 기준, 최대 size, sort whitelist 계약 확정

## Milestone 2. Environment와 Backend bootstrap

목표: API가 잘못된 설정으로 기동하지 않고 일관된 요청/응답 기반을 제공한다.

### M2-1 Environment

- 진행 중인 config 변경을 먼저 별도 검증한다.
- `NODE_ENV`, `PORT`, `WEB_URL`, `DATABASE_URL`, JWT secrets를 startup에서 검증한다.
- 개발, 테스트, production의 필수값 차이를 schema로 표현한다.
- `.env.example`에는 실제 secret을 넣지 않고 형식과 최소 길이만 보여준다.
- ConfigService key type 또는 typed configuration 접근 방식을 정한다.

### M2-2 Bootstrap

- global prefix와 API versioning 정책을 정한다. 권장 endpoint는 `/api/v1/*`, health는 운영 probe 요구에 따라 예외 여부를 결정한다.
- CORS는 단일 문자열이 아닌 명시적 allowlist로 검증한다.
- `ValidationPipe`에 `whitelist`, `forbidNonWhitelisted`, `transform`을 적용한다.
- Helmet, cookie parser, payload size 제한, graceful shutdown을 설정한다.
- reverse proxy 환경의 `trust proxy`와 client IP 신뢰 범위를 배포 환경별로 정한다.

### M2-3 Error와 observability

- 표준 오류에 `code`, 안전한 `message`, 선택적 `details`, `requestId`, `timestamp`를 둔다.
- validation details의 경로와 코드 형식을 정의한다.
- 예상 가능한 4xx와 예상하지 못한 5xx를 구분한다.
- DB/stack/secret/token/password/cookie 원문을 응답과 로그에서 제거한다.
- client가 준 request ID는 형식과 길이를 검증하고 아니면 서버에서 생성한다.
- 구조화 로그에 method, route template, status, duration, requestId를 남기되 health와 PII 정책을 둔다.

### M2-4 OpenAPI

- DTO별 request/response와 error response를 기술한다.
- Cookie auth security scheme을 실제 방식과 일치시킨다. Bearer만 문서화하지 않는다.
- production에서 Swagger UI 공개 여부와 접근 제어를 결정한다.
- 생성된 OpenAPI JSON의 snapshot 또는 schema validation을 CI에 추가한다.

완료 조건:

- [ ] 필수 env 누락 시 명확한 startup 실패
- [ ] 허용되지 않은 origin과 입력 필드 거절
- [ ] 모든 오류가 표준 envelope 사용
- [ ] request ID가 응답과 로그에서 연결됨
- [ ] SIGTERM에서 새 요청 중단 후 정상 종료

## Milestone 3. PostgreSQL과 TypeORM

목표: 재현 가능하고 되돌릴 수 있는 DB 기반을 만든다.

### M3-1 개발 DB

- PostgreSQL만 Core dependency로 Compose에 둔다.
- Redis는 실제 소비 기능이 생기기 전까지 profile 또는 별도 compose로 분리한다.
- host port, DB 이름, volume 이름을 환경 변수로 덮어쓸 수 있게 한다.
- DB password 기본값은 local 전용임을 명시한다.
- test DB는 development DB와 database/volume을 분리한다.

### M3-2 DataSource와 Entity

- Nest runtime과 CLI Migration이 동일한 설정 원천을 사용하게 한다.
- Root가 ESM인 현재 구성에 맞춰 TypeORM CLI의 ESM/CJS 실행 방식, source DataSource와 production `dist` DataSource 경로를 하나의 검증된 script 계약으로 고정한다.
- `synchronize=false`, `migrationsRun=false`를 모든 환경에서 유지한다.
- UUID 생성 방식, timestamp UTC, naming strategy 사용 여부를 결정한다.
- `User.email`은 저장 전 trim/lowercase 정규화하고 case-insensitive unique 보장을 선택한다. 권장안은 normalized column 또는 `citext`를 명시적으로 migration하는 것이다.
- native enum과 varchar+check 중 migration 호환성을 검토해 선택한다.

### M3-3 AuthSession 모델 보강

기존 가이드의 `userId`, `tokenHash`, `expiresAt`, `revokedAt` 외에 다음을 결정한다.

- `familyId` 또는 rotation chain 식별자
- `replacedBySessionId` 또는 이전/다음 token 연결
- reuse 감지 시각과 revoke reason
- created IP/user agent 보존 여부와 개인정보 보존 기간
- `(user_id, revoked_at)`, `expires_at`, token lookup index
- 만료 session 정리 job 또는 운영 command

### M3-4 Migration과 Seed

- generated migration SQL을 사람이 검토한다.
- 신규 schema는 빈 DB forward → show → revert → forward로 검증한다.
- 데이터 변환은 schema 변경과 분리하고 대용량 lock 시간을 고려한다.
- production seed를 개발 seed와 분리한다.
- 관리자 초기 비밀번호를 코드에 하드코딩하지 않는다. env 입력 또는 일회성 bootstrap 절차를 사용한다.
- seed는 idempotent하고 production에서 자동 실행되지 않는다.

완료 조건:

- [ ] 개발/test DB 분리
- [ ] Migration forward/revert/forward 통과
- [ ] unique, FK, index, nullability가 Integration test로 검증됨
- [ ] 앱 시작 시 자동 schema 변경 없음
- [ ] migration 및 seed 운영 절차와 rollback 기록

## Milestone 4. User API와 API contract

목표: 인증이 의존할 최소 User 기능과 일관된 API 규격을 제공한다.

### M4-1 User lifecycle

- 상태 전이를 명시한다: `PENDING → ACTIVE → SUSPENDED/DELETED`.
- Starter v1에서 email verification을 구현하지 않으면 기본 상태를 `ACTIVE`로 두고 `PENDING` 사용을 보류한다.
- `DELETED`를 상태 값으로만 둘지 `deletedAt`과 함께 둘지 결정한다.
- 비활성/정지 사용자의 로그인 및 기존 session 처리 정책을 정의한다.

### M4-2 Contract

- Request DTO, Response DTO, Mapper를 분리한다.
- `createdAt` 등 날짜 응답은 ISO 문자열이다.
- list endpoint는 page가 1부터 시작하며 sort field allowlist와 안정적인 tie-breaker를 둔다.
- 필터 값과 최대 page size를 schema에서 제한한다.
- API error code catalog를 문서화한다.

### M4-3 Authorization boundary

- 일반 사용자는 자신의 profile만 읽고 수정한다.
- 관리자 list/detail/status 변경 API는 별도 guard를 요구한다.
- role 변경과 자기 자신 비활성화처럼 위험한 동작의 정책을 결정한다.
- IDOR 방지를 controller가 아니라 service/authorization 계층에서도 검증한다.

완료 조건:

- [ ] Entity가 응답에 직접 노출되지 않음
- [ ] password hash는 모든 일반 조회와 log에서 제외
- [ ] 중복 email과 없는 user 오류 코드가 안정적임
- [ ] 일반 사용자와 관리자 권한 테스트 존재

## Milestone 5. 인증과 보안

목표: refresh rotation과 session revoke가 포함된 브라우저 인증 흐름을 완성한다.

### M5-1 Endpoint 계약

| Endpoint              | 성공 결과                         | 주요 실패                  | 보호                         |
| --------------------- | --------------------------------- | -------------------------- | ---------------------------- |
| `POST /auth/register` | user + cookie 발급                | email 중복, 약한 password  | rate limit, origin/CSRF      |
| `POST /auth/login`    | user + cookie 발급                | 동일한 일반 인증 실패 응답 | rate limit                   |
| `POST /auth/refresh`  | cookie rotation                   | 만료, revoke, reuse        | 강한 rate limit, transaction |
| `POST /auth/logout`   | 현재 session revoke + cookie 삭제 | 멱등 성공                  | 인증 또는 refresh cookie     |
| `GET /auth/me`        | 현재 user                         | 미인증/비활성 user         | access guard                 |

로그인 실패 응답은 email 존재 여부를 노출하지 않는다.

### M5-2 Password

- 최소 길이와 최대 byte 길이를 둔다. 최대 길이는 hashing DoS를 방지한다.
- Argon2 parameter는 서버 성능 기준으로 benchmark 후 상수로 관리한다.
- password hash algorithm/parameter upgrade를 로그인 시 수행할 수 있게 버전을 보존한다.
- register/login DTO와 log redaction test를 둔다.

### M5-3 Token과 session

- JWT claim은 최소 `sub`, `sid`, `role`, `iat`, `exp`, 필요 시 `iss`, `aud`로 제한한다.
- access와 refresh secret/key, issuer, audience를 분리한다.
- refresh rotation의 조회, 검증, revoke, 신규 session 저장은 transaction으로 처리한다.
- 이미 교체된 refresh token 재사용 시 해당 family 전체를 revoke한다.
- 경쟁하는 refresh 요청 중 하나만 성공하도록 row lock 또는 atomic update를 사용한다.
- logout과 password/role/status 변경 시 revoke 범위를 정의한다.

### M5-4 Cookie와 CSRF

- Cookie option을 환경별 단일 함수에서 생성한다.
- 발급과 삭제에 동일한 name/path/domain/sameSite/secure를 사용한다.
- 허용 origin 검사와 필요한 CSRF token 전략을 구현한다.
- CORS wildcard와 credentials 조합을 금지한다.

### M5-5 Abuse 방어

- login/register/refresh에 endpoint별 rate limit을 둔다.
- proxy 환경에서 공격자가 임의 IP header를 신뢰하게 하지 않는다.
- 계정 잠금은 DoS 위험이 있어 Starter 기본값으로 강제하지 않고 rate limit과 monitoring을 우선한다.
- auth event는 secret 없이 성공/실패 종류, requestId, userId(확인된 경우)만 기록한다.

완료 조건:

- [ ] register/login/me/refresh/logout 정상 및 실패 test
- [ ] token reuse와 동시 refresh test
- [ ] 정지/삭제 user의 기존 token 거절
- [ ] Cookie option 및 삭제 일치 test
- [ ] CSRF/origin, CORS, rate limit test
- [ ] transaction rollback 시 부분 user/session 없음

## Milestone 6. Frontend data와 인증

목표: SSR/CSR 경계를 고려한 안정적인 API 및 인증 UX를 만든다.

### M6-1 API Client

- ADR-004에 따라 base URL과 Cookie 전달 방식을 정한다.
- GET/HEAD에는 불필요한 `Content-Type`을 강제하지 않는다.
- 204 response와 JSON이 아닌 error body를 안전하게 처리한다.
- timeout은 `AbortController`로 구현하고 호출자의 `AbortSignal`과 결합한다.
- 자동 refresh는 단일-flight로 처리하고 무한 재시도를 방지한다.
- 서버/브라우저 실행 환경을 분리하고 server-side request에서 사용자 Cookie가 다른 요청과 공유되지 않게 한다.

### M6-2 Query

- QueryClient를 요청 간 공유하지 않는 SSR 구성을 사용한다.
- query key factory와 invalidation 규칙을 feature 단위로 둔다.
- auth/me는 retry와 stale 정책을 일반 query와 분리한다.
- 민감한 user data를 local persistence하지 않는다.

### M6-3 Form과 오류

- Client Zod는 UX를 위한 1차 검증이며 서버 검증이 최종 기준이다.
- field error와 form/global error 매핑을 정의한다.
- 제출 중 중복 요청, 성공 후 navigation, focus 이동을 처리한다.
- password를 state persistence와 analytics에 남기지 않는다.

### M6-4 Route protection

- Server Component/Proxy(middleware)/Client guard 각각의 책임을 정한다.
- client loading 화면만으로 보안을 구현하지 않는다. 데이터/API 권한은 항상 API가 검증한다.
- 로그인 후 원래 경로 복귀는 open redirect를 막도록 same-origin 상대 경로만 허용한다.
- 401과 403 UX를 구분한다.

완료 조건:

- [ ] 새로고침과 direct navigation에서 auth state 정확
- [ ] 만료 access token의 동시 요청 refresh 1회
- [ ] refresh 실패 시 query 정리 후 로그인 이동
- [ ] open redirect 및 무한 redirect 없음
- [ ] login form keyboard/focus/error 접근성 검증

## Milestone 7. Design system과 UI

목표: 프로젝트 Domain 없이도 재사용 가능한 시각 체계와 기본 컴포넌트를 제공한다.

### M7-1 Foundation과 token

- color, typography, spacing, radius, shadow, motion, breakpoint, z-index를 정의한다.
- raw palette → semantic token → component token → component의 단방향 의존을 유지한다.
- status color는 brand와 분리하고 light/dark 모두 WCAG contrast를 확인한다.
- CSS variable naming, fallback, public override 범위를 문서화한다.

### M7-2 Appearance

- `theme × style × brand × density`의 조합 폭발을 막기 위해 지원 조합과 기본값을 명시한다.
- SSR에서 Cookie 또는 inline 초기화로 첫 paint 전에 theme을 결정해 flash를 방지한다.
- 잘못되거나 과거 버전의 저장 값을 기본값으로 복구한다.
- custom brand 입력은 허용 형식과 contrast fallback을 검증한다.
- OS `prefers-color-scheme`과 `prefers-reduced-motion`을 존중한다.

### M7-3 Component

- Primitive는 shadcn/Radix 기반 접근성을 유지한다.
- Button, Input, Select, Checkbox, Dialog, Toast, FormField, Badge부터 구현한다.
- loading, disabled, error, empty 상태와 keyboard interaction을 component test로 검증한다.
- Confirm API는 Promise 중복 호출, focus return, escape/backdrop 정책을 정의한다.

### M7-4 Layout와 DataTable

- AppShell, Header, Sidebar, Content, PageHeader의 responsive/keyboard 동작을 정한다.
- DataTable은 server pagination을 기본으로 하고 URL query를 상태 기준으로 사용한다.
- sort/filter/search parameter를 Backend contract와 동일하게 한다.
- loading/empty/error/partial data, row identity, selection 범위를 정의한다.

완료 조건:

- [ ] 지원 Appearance 조합의 Story 존재
- [ ] keyboard navigation과 focus visible 동작
- [ ] 핵심 text/control contrast 기준 충족
- [ ] reduced motion 지원
- [ ] package가 특정 Domain이나 API에 의존하지 않음

## Milestone 8. Test 체계

목표: 빠른 단위 검증과 실제 경계 검증을 분리하고 CI에서 재현한다.

### M8-1 Test pyramid

- API Jest unit: service, mapper, guard, error mapping, token policy
- DB integration: 실제 PostgreSQL + migration + repository/transaction
- Web Vitest: form, hook, query adapter, provider, component
- Playwright: register/login/protected route/logout/admin/appearance 핵심 경로
- Storybook: visual state catalog. 자동 visual regression은 도구가 확정될 때 선택한다.

### M8-2 격리와 fixture

- test worker별 database/schema 또는 직렬 실행 정책을 정한다.
- test는 production DB URL을 명시적으로 거부한다.
- Migration으로 DB를 준비하고 `synchronize`를 사용하지 않는다.
- factory는 테스트 의도를 드러내는 최소 필드만 기본 제공한다.
- 시간, UUID, token expiry는 주입 가능한 clock/fixture로 결정적으로 검증한다.

### M8-3 품질 gate

- 변경 범위의 unit/component test는 필수다.
- Migration/Repository/Auth 변경은 DB integration을 필수로 한다.
- 사용자 핵심 경로 변경은 관련 Playwright scenario를 필수로 한다.
- coverage 수치는 초기 측정 후 현실적인 threshold를 정하고 핵심 보안 분기는 별도 test checklist로 보장한다.

완료 조건:

- [ ] 로컬과 CI의 test command 동일
- [ ] flaky retry로 실패를 숨기지 않음
- [ ] 병렬 실행 시 상태 충돌 없음
- [ ] 실패 artifact로 log/screenshot/trace 확인 가능하며 secret은 제거됨

## Milestone 9. Health, CI, Production

목표: 안전하게 build, migrate, deploy, rollback할 수 있는 최소 운영 기반을 만든다.

### M9-1 Health와 shutdown

- liveness는 process event loop가 응답 가능한지만 검사한다.
- readiness는 필수 dependency인 PostgreSQL만 기본 검사한다.
- Optional Redis나 외부 API는 실제로 필수 기능이 될 때 readiness에 포함한다.
- health response에 secret, 내부 host, stack trace를 노출하지 않는다.
- SIGTERM 시 readiness를 내리고 연결을 drain한 후 DB를 종료한다.

### M9-2 CI

PR pipeline:

```text
frozen install → format check → lint → typecheck → unit/component
→ migration/integration → build → 핵심 E2E
```

- 최소 권한 token과 dependency cache를 사용한다.
- lockfile 변경 검증, secret scanning, dependency audit 정책을 정한다.
- PR의 Entity 변경에 Migration이 함께 있는지 review checklist로 확인한다.
- OpenAPI artifact와 production image build 가능성을 검증한다.

### M9-3 Production image

- Web/API는 multi-stage image로 분리한다.
- final image는 non-root user, production dependency, read-only filesystem 가능성을 고려한다.
- `.env`, test fixture, source map 공개 범위, local cache를 image에 넣지 않는다.
- image에 OCI label/version/commit SHA를 기록한다.
- container 시작 시 migration을 모든 replica가 동시에 자동 실행하지 않는다. 별도 one-off job으로 실행한다.

### M9-4 Migration과 release

- ADR-007 순서를 적용한다.
- release마다 migration 예상 시간, lock 위험, 호환 버전, rollback/roll-forward를 기록한다.
- destructive change는 최소 한 release의 호환 기간을 둔다.
- migration 실패 시 traffic 전환 전 중단한다.
- image rollback 후에도 schema가 이전 앱과 호환되는지 사전 검증한다.

완료 조건:

- [ ] clean environment의 CI 전체 통과
- [ ] image 내 non-root 실행과 health 검증
- [ ] 빈 DB에서 production migration 및 API readiness 성공
- [ ] migration 실패와 app rollback runbook 검증

## Milestone 10. 문서화와 Starter v1 배포

목표: 구현자 없이도 설치·개발·운영 가능한 재사용 Starter로 마감한다.

필수 문서:

- `README.md`: 목적, quick start, 표준 명령, Workspace 지도
- `docs/architecture.md`: module 책임, dependency 방향, 요청/data 흐름
- `docs/environment.md`: 변수 목록, 환경별 필수값, secret rotation
- `docs/database.md`: Entity/관계/index/보존 정책
- `docs/typeorm.md`: repository/query/transaction 규칙
- `docs/migration.md`: 생성, review, test, deploy, rollback/runbook
- `docs/authentication.md`: Cookie/token/session/CSRF/threat model
- `docs/authorization.md`: role/permission와 endpoint matrix
- `docs/api-convention.md`: versioning, DTO, pagination, error code
- `docs/frontend-convention.md`: SSR/CSR, query/form/error/route 규칙
- `docs/design-system.md`: token dependency와 component layer
- `docs/appearance.md`: resolution, persistence, SSR, override
- `docs/testing.md`: runner, fixture, DB 격리, 명령
- `docs/deployment.md`: image, migration, health, rollback
- `docs/adr/`: 4절의 결정 기록

Release checklist:

- [ ] Core/Standard/Optional 구분과 실제 package가 일치
- [ ] example env만으로 local startup 가능
- [ ] 전체 표준 명령 및 CI 통과
- [ ] 빈 DB 설치와 기존 DB migration 경로 검증
- [ ] 보안 checklist와 dependency 취약점 처리 기준 확인
- [ ] 지원 Node/pnpm/browser/PostgreSQL 버전 명시
- [ ] starter 생성 또는 복제 후 불필요한 식별 정보 없음
- [ ] tag/release note/changelog 작성

## 7. 단계 간 의존성과 권장 순서

```text
M0 기준선
 └─> M1 공통 패키지
      └─> M2 환경/Bootstrap
           └─> M3 DB
                └─> M4 User/API
                     └─> M5 Auth/Security
                          └─> M6 Frontend Auth

M1 ─> M7 Design System/UI

M2~M7 ─> M8 Test 체계
M3 + M8 ─> M9 CI/Production
전체 완료 ─> M10 Documentation/Starter v1
```

M7의 Foundation 작업은 M3~M5와 파일 소유권이 겹치지 않으므로 계약이 확정된 뒤 병렬 진행할 수 있다. M6의 Frontend Auth는 M5 endpoint와 Cookie 계약이 확정된 후 진행한다. M9의 Production Migration은 M3의 migration 규칙과 M8의 실제 DB 검증 없이는 시작하지 않는다.

## 8. 작업 분할과 커밋 후보

아래는 cherry-pick 가능한 논리 단위 예시다. 실제 커밋은 사용자가 명시적으로 요청한 경우에만 수행한다.

1. `chore: 런타임 및 워크스페이스 기준 정리`
2. `chore: 공통 타입스크립트 및 린트 설정 구성`
3. `feat: 환경 변수 검증과 API 부트스트랩 구성`
4. `feat: API 오류 및 요청 추적 기반 구성`
5. `feat: PostgreSQL 개발 환경 구성`
6. `feat: TypeORM 데이터소스와 기본 엔티티 구성`
7. `feat: 사용자 및 인증 세션 마이그레이션 추가`
8. `feat: 사용자 API 계약 구현`
9. `feat: 쿠키 기반 인증과 토큰 회전 구현`
10. `feat: 프런트 API 클라이언트와 인증 흐름 구현`
11. `feat: 디자인 토큰과 Appearance 기반 구성`
12. `feat: 공통 UI와 DataTable 구성`
13. `test: 통합 및 E2E 검증 구성`
14. `ci: 품질 검증 파이프라인 구성`
15. `build: 운영 이미지와 마이그레이션 절차 구성`
16. `docs: Starter v1 사용 및 운영 문서 정리`

## 9. 주요 위험과 대응

| 위험                                     | 영향                        | 대응                                                    |
| ---------------------------------------- | --------------------------- | ------------------------------------------------------- |
| TypeScript/Framework 메이저 불일치       | build/type 오류             | ADR-001과 clean install/build 선행                      |
| source export package의 런타임 해석 차이 | Web은 성공, API는 실패 가능 | ADR-002 후 양쪽 dev/build/test 검증                     |
| Cookie 인증의 CSRF 누락                  | 사용자 권한으로 위조 요청   | origin/CSRF 계약을 Auth 전에 확정                       |
| refresh 동시성 및 reuse 미처리           | 탈취 token 장기 사용        | session family, atomic rotation, integration test       |
| email 대소문자 unique 불일치             | 중복 계정                   | DB 수준 정규화/unique 전략 확정                         |
| native enum 변경                         | migration 어려움            | schema 선택과 expand/contract review                    |
| 앱보다 늦은 migration                    | 새 코드 기동 실패           | 호환 migration 선행 후 traffic 전환                     |
| CI lint가 `--fix`로 변경 생성            | 재현 불가/누락 은폐         | check와 fix script 분리                                 |
| SSR 전역 QueryClient/API state           | 사용자 데이터 누출          | request-scoped instance 및 격리 test                    |
| Optional dependency를 readiness에 포함   | 불필요한 전체 장애          | 필수 dependency만 readiness에 포함                      |
| Seed에 기본 관리자 password 저장         | 계정 탈취                   | secret 입력/일회성 bootstrap, production 자동 seed 금지 |
| 로그의 token/password/PII 노출           | 보안 및 개인정보 사고       | 중앙 redaction과 negative test                          |

## 10. 다음 실행 범위

현재 기준에서 바로 진행할 작업은 다음 순서가 적절하다.

1. 진행 중인 Environment config 사용자 변경을 검증하고 하나의 논리 단위로 마감한다.
2. ADR-001, ADR-002, ADR-004, ADR-005 초안을 작성해 후속 계약을 고정한다.
3. M0의 중복 Workspace 파일, CI용 lint, Turbo task 계약을 정리한다.
4. M1의 실제 ESLint config와 shared package 검증을 완료한다.
5. 이후 M2 Backend bootstrap으로 넘어간다.

DB나 Auth 구현을 먼저 시작하면 package/runtime/auth 계약 변경에 따른 재작업 가능성이 높다. 따라서 위 다섯 단계가 다음 개발 주기의 진입 조건이다.

## 11. 미결정 및 확인 필요 사항

다음은 저장소에서 확인할 수 없어 구현 전에 소유자 결정이 필요한 항목이다.

- production hosting, reverse proxy, domain과 TLS 구성
- CI provider와 image registry
- secrets manager와 secret rotation 절차
- 지원 browser/OS와 접근성 목표 수준
- `docs/atlas-industrial-violet.html`을 공식 디자인 기준으로 사용할지 여부
- DataTable을 Starter 내부 fixture로 검증할지, 실제 프로젝트에서 검증 후 승격할지 여부
- OAuth, email verification, password reset을 Starter v1에서 제외한다는 최종 승인

결정 전에도 M0~M2의 provider 독립 작업은 진행할 수 있다. 인증 Cookie와 production image에 영향을 주는 항목은 ADR-004, ADR-005, ADR-008 확정 전 구현을 시작하지 않는다.
