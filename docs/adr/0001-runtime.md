# ADR-0001: Runtime과 TypeScript 지원 정책

- Status: Accepted
- Date: 2026-08-12
- Owner: Release owner

## Context

Root와 app이 서로 다른 TypeScript 범위를 사용하고 Node 선택 파일과 CI matrix가 없으면 같은 commit도 개발 환경과 clean consumer에서 다른 결과를 낼 수 있다. 저장소 개발 환경의 완전한 재현과 배포된 package/template 소비자의 현실적인 지원 범위는 별도 계약이어야 한다.

## Decision

- Cornerstone 저장소의 개발·CI 기준 runtime은 Node `24.18.0`, pnpm `11.20.0`, TypeScript `5.9.3`으로 정확히 고정한다.
- `.nvmrc`, `.node-version`, Root `engines`, `packageManager`, CI toolchain과 lockfile이 같은 값을 사용한다.
- 생성된 Next.js/NestJS application과 공개 package의 Node 지원 범위는 현재 지원 중인 LTS인 `>=22.20.0 <25`로 시작한다. package별로 더 좁은 범위가 필요하면 해당 package가 명시한다.
- 최소 소비자 CI는 Node `22.20.0`, 기준 CI와 release artifact 생성은 Node `24.18.0`에서 실행한다. EOL runtime은 Framework가 기술적으로 허용해도 지원하지 않는다.
- TypeScript는 workspace 전체에서 단일 version을 사용한다. Framework가 해당 version을 지원하지 않으면 ADR과 compatibility matrix를 먼저 갱신하고 upgrade한다.
- `pnpm install --frozen-lockfile`이 유일한 CI 설치 경로이며 Root `pnpm-lock.yaml`만 source of truth로 추적한다.
- Runtime 변경은 lockfile, 양 app build, public package external-consumer와 Certified Profile 검증을 동반한다.

## Consequences

- 개발·CI 결과와 release artifact builder가 동일한 runtime을 사용한다.
- 지원 범위의 최저 Node에서도 공개 소비 계약을 검증하면서 개발 도구는 하나의 기준 version으로 재현한다.
- Node, pnpm 또는 TypeScript 변경은 독립적인 compatibility 변경으로 review한다.
