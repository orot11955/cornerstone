# Cornerstone 구현 계획

> 설계 기준: [`cornerstone_assembly_diagram.md`](./cornerstone_assembly_diagram.md)
> 기준일: 2026-08-12

이 문서는 Cornerstone Starter v1의 현재 상태, 선행 결정, 실행 순서와 완료 조건만 관리한다. 제품 경계와 영속적인 설계 원칙은 설계 기준 문서에서 단일하게 정의한다.

## 1. 완료 기준

새 저장소에서 다음 흐름을 별도 구조 변경 없이 재현할 수 있어야 한다.

1. Root에서 의존성을 설치하고 Web/API를 함께 실행한다.
2. 빈 PostgreSQL에 Migration과 개발 Seed를 적용한다.
3. 회원가입, 로그인, 인증 갱신, 로그아웃과 Role 접근 제어를 검증한다.
4. Theme, Style, Brand, Density를 조합하고 새로고침 후 복구한다.
5. Root의 format, lint, typecheck, test, build와 CI를 통과한다.
6. Production image와 Migration을 순서대로 배포하고 readiness를 확인한다.

모든 작업은 다음 원칙을 따른다.

- 하나의 논리적 변경과 검증을 한 단위로 유지한다.
- API, 데이터, 환경 변수 또는 사용자 동작 변경을 명시한다.
- DB 변경에는 Migration, 데이터 변환, 호환성, 배포 순서와 rollback을 포함한다.
- 인증·사용자 데이터 변경에는 권한, CSRF, 개인정보와 secret 노출 검토를 포함한다.
- 실행하지 않은 검증은 완료로 표시하지 않는다.

## 2. 현재 기준선

아래 표는 파일을 기준으로 한 정적 상태이며 실행 검증 결과가 아니다.

| 영역 | 상태 | 다음 핵심 작업 |
| --- | --- | --- |
| Workspace/Turbo | 진행 | runtime 고정, task와 output 계약 검증 |
| Web | 기본 scaffold | 공통 설정, data/auth/UI 구조 적용 |
| API | 기본 scaffold + config 작업 | config 검증 후 bootstrap 확장 |
| Shared packages | 빈 골격 중심 | 책임, export와 의존 방향 검증 |
| Database/Auth/UI/Test/CI | 미착수 | 아래 Milestone 순서로 구현 |
| Documentation | 진행 | 구현과 함께 실제 계약만 갱신 |

기존 사용자 변경은 별도 작업으로 보존한다. 특히 `apps/api/src/config/*`, API bootstrap, schema package와 lockfile을 후속 작업에서 임의로 정리하지 않는다.

## 3. 선행 결정

결정은 해당 Milestone 직전에 ADR로 기록한다.

| ADR | 결정할 내용 | 권장 기준 |
| --- | --- | --- |
| 001 Runtime | Node, pnpm, TypeScript 지원 버전 | Root 단일 버전·lockfile |
| 002 Package | source export 또는 build artifact | Starter v1은 source export 후 양 앱 build 검증 |
| 003 API | 계약의 Source of Truth | Nest DTO/OpenAPI, Entity 비노출 |
| 004 Network | Browser→API 또는 Next BFF | 한 방식 선택, CORS/Cookie/SSR 함께 정의 |
| 005 Auth | Cookie, CSRF, refresh rotation | HttpOnly, strict origin, token family/reuse 감지 |
| 006 Test | package별 runner | API Jest, Web/UI Vitest, E2E Playwright |
| 007 Release | Migration과 배포 순서 | expand → migrate → deploy → contract |
| 008 Operations | hosting, TLS, secret, registry | provider 확정 전 표준 image/env까지만 Core |

## 4. Milestone

각 Milestone은 앞 단계의 공개 계약을 입력으로 사용한다. 상세 구현법은 작업 시점의 설치 버전과 공식 API를 확인해 결정한다.

### M0. 기준선 안정화

목표:

- Node/pnpm/TypeScript 기준과 Root 단일 Workspace를 확정한다.
- 모든 package의 `lint`, `typecheck`, `test`, `build` 적용 범위를 정한다.
- CI용 lint와 수정용 lint를 분리하고 Turbo input/output을 검증한다.

검증:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

완료: clean clone에서 설치와 표준 명령이 재현되고 기존 실패가 별도로 기록된다.

### M1. 공통 패키지

목표:

- 실행 환경별 TypeScript/ESLint preset을 구현한다.
- `types`, `schemas`, `utils`, `config`, `api-client`, `ui`의 public export와 허용 의존성을 고정한다.
- 앱 내부 import, 순환 의존과 Domain의 공통 package 유입을 차단한다.

검증: 각 package의 typecheck/build와 Web/API의 실제 import·production build.

완료: [`cornerstone_assembly_diagram.md`](./cornerstone_assembly_diagram.md)의 의존 방향을 모든 package가 만족한다.

### M2. Environment와 API 기반

목표:

- 환경별 필수 변수를 startup에서 검증하고 secret을 로그에 남기지 않는다.
- API version, CORS allowlist, ValidationPipe, Cookie, Helmet과 graceful shutdown을 구성한다.
- 표준 오류, request ID, 구조화 로그와 Cookie auth OpenAPI를 제공한다.

검증: env 누락, 허용되지 않은 origin/field, 오류 envelope, request ID 연결과 SIGTERM 종료.

완료: 잘못된 설정은 기동 전에 실패하고 모든 요청이 동일한 검증·오류·관측 경계를 지난다.

### M3. PostgreSQL과 TypeORM

목표:

- 개발/test DB를 분리하고 Nest runtime과 CLI가 같은 설정 원천을 사용한다.
- `User`, `AuthSession`, index, 제약과 session rotation 데이터를 Migration으로 정의한다.
- 멱등 개발 Seed와 운영 Migration 절차를 만든다.

검증: 빈 DB에서 `forward → revert → forward`, Repository/transaction integration test, `synchronize=false` 확인.

Rollback: 파괴적 변경을 한 release에 섞지 않고 앱 rollback과 DB roll-forward 가능성을 각각 기록한다.

### M4. User와 API 계약

목표:

- User lifecycle과 관리자/본인 접근 경계를 정한다.
- Request/Response DTO와 Mapper를 Entity에서 분리한다.
- pagination, sort allowlist, 날짜와 오류 code를 일관되게 제공한다.

검증: 중복 email, 없는 사용자, 일반 사용자/관리자 권한, password hash 비노출.

완료: OpenAPI와 실제 응답이 일치하고 IDOR 방어가 service/authorization 경계에도 존재한다.

### M5. 인증과 보안

목표:

- register, login, me, refresh, logout을 Cookie 기반으로 구현한다.
- access/refresh key를 분리하고 refresh rotation, 동시성, reuse 감지와 session revoke를 transaction으로 처리한다.
- CSRF/origin, CORS, rate limit, password hashing과 log redaction을 적용한다.

검증: 정상/실패 흐름, 동시 refresh, token reuse, 정지 사용자, Cookie 삭제 일치, rollback과 abuse 방어.

Rollback: 이전 앱과 session schema의 호환 기간을 확보하고 강제 로그아웃 필요 여부를 release에 기록한다.

### M6. Frontend data와 인증

목표:

- SSR/Browser 경계를 분리한 API client와 request-scoped QueryClient를 구성한다.
- refresh single-flight, form error mapping과 보호 경로 UX를 구현한다.
- API 권한 검증을 대체하지 않는 route guard를 제공한다.

검증: 새로고침/direct navigation, 동시 401, refresh 실패, 401/403, open redirect와 keyboard/focus 동작.

완료: 요청 간 사용자 상태가 공유되지 않고 인증 실패가 무한 재시도나 redirect를 만들지 않는다.

### M7. 디자인 시스템과 UI

목표:

- 설계 문서의 `Foundations → Semantic → Component → Domain` 토큰 계약을 구현한다.
- `Theme × Style × Brand × Density`를 독립적으로 해석하고 SSR 첫 paint 전에 적용한다.
- Domain 독립 Primitive, Composite와 Layout 컴포넌트를 제공한다.

검증:

- 지원 Appearance 조합과 잘못된 저장값 복구
- light/dark contrast, keyboard, focus visible과 reduced motion
- loading, disabled, empty와 error 상태
- `packages/ui`의 API/Domain 비의존

완료: ATLAS는 `dark + industrial + signal-violet + default` 레퍼런스로만 사용되고 Cornerstone 기본 preset이나 공용 token 원본으로 취급되지 않는다.

### M8. 테스트 체계

목표:

- API Jest unit, PostgreSQL integration, Web/UI Vitest, Playwright E2E의 책임을 분리한다.
- test DB 격리, fixture, clock과 실패 artifact를 재현 가능하게 구성한다.
- production DB 연결을 test에서 명시적으로 거부한다.

검증: 로컬과 CI가 같은 명령을 사용하고 병렬 실행이 상태 충돌을 만들지 않는다.

완료: 핵심 인증·권한·Migration·Appearance 경로가 적절한 계층에서 검증된다.

### M9. CI와 Production

목표:

- frozen install부터 E2E까지 품질 gate를 구성한다.
- Web/API non-root production image, liveness/readiness와 graceful shutdown을 제공한다.
- Migration one-off job과 traffic 전환·rollback runbook을 정의한다.

```text
install → format → lint → typecheck → unit/component
→ migration/integration → build → E2E → image
→ compatible migration → deploy → readiness → traffic
```

완료: clean 환경과 빈 DB에서 pipeline, image, Migration과 readiness가 재현된다.

### M10. Starter v1 배포

목표:

- Root와 앱 README에 실제 설치·실행·검증·운영 절차를 기록한다.
- 구현된 계약에 필요한 문서만 작성하고 미구현 문서를 선생성하지 않는다.
- Starter 생성 후 제품명, Domain과 secret이 남지 않는지 확인한다.

완료: 구현자 도움 없이 새 프로젝트를 만들고 핵심 시나리오와 rollback 절차를 수행할 수 있다.

## 5. 의존 순서

```text
M0 → M1 → M2 → M3 → M4 → M5 → M6
      └──────────────────────→ M7

M2~M7 → M8 → M9 → M10
```

- M7은 M1의 package/token 계약 뒤 독립 진행할 수 있다.
- M6은 M5의 endpoint와 Cookie 계약 뒤 진행한다.
- M9의 Migration 배포는 M3 규칙과 M8의 실제 DB 검증 뒤 진행한다.

## 6. 주요 위험

| 위험 | 대응 |
| --- | --- |
| framework/TypeScript 버전 불일치 | ADR-001과 clean build 선행 |
| shared source의 Web/API 해석 차이 | 양쪽 dev/build/test로 계약 검증 |
| Cookie 인증의 CSRF 또는 CORS 누락 | ADR-004/005와 negative test |
| refresh 경쟁과 reuse 미처리 | atomic rotation과 integration test |
| 비호환 Migration | expand/contract와 traffic 전 검증 |
| SSR 전역 상태의 사용자 데이터 누출 | request-scoped instance와 격리 test |
| log/seed의 secret·개인정보 노출 | 중앙 redaction, negative test와 일회성 bootstrap |
| Appearance 조합별 대비 회귀 | 지원 matrix와 자동/수동 접근성 검증 |

## 7. 다음 실행 범위

1. 진행 중인 API environment 변경을 별도 검증하고 마감한다.
2. ADR-001, 002, 004, 005로 runtime/package/network/auth 계약을 확정한다.
3. M0의 Workspace, lint와 Turbo task 계약을 정리한다.
4. M1 공통 설정과 package export를 구현한다.
5. 이후 M2 API bootstrap으로 진행한다.

Production provider, TLS, registry, secret manager와 지원 browser/OS는 아직 미결정이다. provider 독립 작업은 진행할 수 있지만 Cookie의 production 속성과 image 배포 계약은 ADR-008 전 확정하지 않는다.
