# Cornerstone

Cornerstone은 새 TypeScript 풀스택 프로젝트에서 반복되는 기반을 공통 패키지와 프로젝트 템플릿으로 제공하는 Starter Kit이다.

현재 저장소는 기반을 단계적으로 구축 중이다. Next.js Web, NestJS API와 shared package 골격은 존재하지만 Database, Auth, 공통 UI, Test와 CI 전체가 완성된 상태는 아니다. 진행 상태는 [구현 계획](./docs/cornerstone_implementation_plan.md)을 기준으로 확인한다.

## Workspace

```text
apps/web        Next.js Frontend
apps/api        NestJS Backend
packages/*      설정, 타입, schema, API client, UI와 utility
docs/           설계 계약, 구현 계획과 시각 레퍼런스
```

## 시작하기

요구 도구:

- Node.js: 지원 버전 확정 전
- pnpm `11.20.0`

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm dev
```

기본 개발 포트는 Web `3000`, API `4000`이다. `.env`에는 실제 secret을 커밋하지 않는다.

## 표준 명령

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

각 명령은 Turborepo를 통해 해당 script가 있는 Workspace에 실행된다. 일부 package는 아직 모든 표준 script를 제공하지 않으므로 완료 여부는 구현 계획을 따른다.

개별 앱 명령은 [Web README](./apps/web/README.md)와 [API README](./apps/api/README.md)를 참고한다.

## 핵심 설계

- 앱과 공통 package의 의존 방향, Backend/Data 경계: [아키텍처와 설계 원칙](./docs/cornerstone_assembly_diagram.md)
- 작업 순서, 결정 사항과 완료 조건: [구현 계획](./docs/cornerstone_implementation_plan.md)
- Industrial + Signal Violet 조합의 비규범적 예시: [ATLAS 레퍼런스](./docs/atlas-industrial-violet.html)

디자인 시스템은 `Foundations → Semantic → Component → Domain` 토큰 계층과 독립적인 `Theme × Style × Brand × Density` Appearance 축을 사용한다. ATLAS는 Cornerstone의 default theme이 아니다.
