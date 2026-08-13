# Cornerstone

Cornerstone은 새 TypeScript 풀스택 프로젝트에서 반복되는 기반을 공통 패키지와 하나의 canonical template으로 제공하는 Starter Kit이다. 모든 기능을 한꺼번에 설치하지 않고 초기 설정이나 capability manifest에서 선택한 기반만 생성한다.

현재 저장소는 기반을 단계적으로 구축 중이다. Next.js Web, NestJS API, shared package, PostgreSQL Migration, password-session Auth, SSR 인증 화면과 Core UI는 구현되어 있지만 공개 Docs Portal과 운영 배포 전체는 아직 완성되지 않았다. 진행 상태는 [구현 계획](./docs/cornerstone_implementation_plan.md)을 기준으로 확인한다.

## Workspace

```text
apps/web        Next.js Frontend
apps/api        NestJS Backend
packages/*      설정, 타입, schema, API client, UI와 utility
docs/           설계 계약, 구현 계획과 시각 레퍼런스
```

향후 `apps/docs`를 별도 origin에 배포해 문법/API reference, 실행 가능한 예제 코드, 예시 화면과 버전별 package/template 다운로드 안내를 제공한다. 현재 `docs/`는 저장소 내부 설계 문서이며 공개 문서 포털은 아직 구현 전이다.

기본 생성 Profile은 Next.js, NestJS, PostgreSQL/TypeORM, password-session Auth와 Core UI를 포함하는 `standard`다. `minimal`, `production`, `regulated` Profile도 별도 Template 복사본이 아니라 같은 manifest preset으로 관리하며 Queue, Tenant, Storage 같은 extension은 선택하지 않으면 코드·의존성·환경 변수에 포함하지 않는다. 확정된 조합 원칙은 [ADR Index](./docs/adr/README.md)를 따른다.

## 시작하기

요구 도구:

- Node.js `24.18.0`
- pnpm `11.20.0`
- Docker/Compose (local PostgreSQL과 DB integration/E2E)

```bash
pnpm install
pnpm db:dev:up
cp apps/api/.env.example apps/api/.env
pnpm migration:run
pnpm dev
```

API `.env` 복사와 PostgreSQL Migration은 필수 선행 단계다. `WEB_URL`, `DATABASE_URL`, access/refresh secret이 없거나 pending Migration이 있으면 API가 기동 또는 readiness를 거절한다. 기본 개발 포트는 Web `3000`, API `4000`이며 `.env`에는 실제 secret을 커밋하지 않는다. 비밀 없는 reference data가 필요하면 `pnpm seed`를 선택적으로 실행한다.

## 표준 명령

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm format:check
```

`dev`, `build`, `lint`, `typecheck`와 workspace test는 Turborepo를 사용한다. DB integration/E2E는 격리된 test Compose를 재생성하고 종료한다. `test:e2e`는 API E2E, UI browser fixture와 실제 PostgreSQL·Nest·Next 인증 수직 경로를 실행하며 `format:check`는 Root Prettier가 저장소 전체를 검사한다. 세부 참여 범위와 완료 여부는 구현 계획을 따른다.

개별 앱 명령은 [Web README](./apps/web/README.md)와 [API README](./apps/api/README.md)를 참고한다.

## 핵심 설계

- 앱과 공통 package의 의존 방향, Backend/Data 경계: [아키텍처와 설계 원칙](./docs/cornerstone_assembly_diagram.md)
- 작업 순서, 결정 사항과 완료 조건: [구현 계획](./docs/cornerstone_implementation_plan.md)
- Industrial + Signal Violet 조합의 비규범적 예시: [ATLAS 레퍼런스](./docs/atlas-industrial-violet.html)

디자인 시스템은 `Foundations → Semantic → Component → Domain` 토큰 계층과 독립적인 `Theme × Style × Brand × Density` Appearance 축을 사용한다. `packages/ui`는 소수 Primitive만 제공하는 패키지가 아니라, 일반적인 제품 화면 대부분을 같은 디자인과 상호작용 규칙으로 구성할 수 있는 범용 UI Kit을 목표로 한다. ATLAS는 Cornerstone의 default theme이 아니다.
