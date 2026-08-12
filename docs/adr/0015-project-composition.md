# ADR-0015: Canonical Template과 Capability Manifest

- Status: Accepted
- Date: 2026-08-12
- Owner: Release owner

## Context

Cornerstone은 프로젝트마다 필요한 기반을 조합하는 Starter Kit이다. 기능 조합별 Template을 복제하면 보안 수정, 설정과 upgrade 경로가 서로 달라지고, 모든 기능을 항상 생성하면 사용하지 않는 코드·의존성·환경 변수를 제거해야 한다.

## Decision

- Template 원천은 하나의 canonical template만 유지한다.
- 프로젝트 생성 시 `cornerstone.config.yml`의 capability manifest를 먼저 확정하고 선택된 코드·설정·의존성·환경 변수·인프라만 생성한다.
- `minimal`, `standard`, `production`, `regulated`는 별도 Template이 아니라 manifest preset이다.
- Profile은 기본 manifest로 먼저 확장되고 사용자가 승인한 override를 적용한 resolved manifest를 생성 결과에 저장한다.
- 기본 Profile은 `standard`이며 Next.js, NestJS, Core UI, PostgreSQL/TypeORM과 password-session Auth를 포함한다.
- Queue, Tenant, Realtime, OAuth/MFA, Mail provider와 Object Storage는 명시적으로 선택하지 않으면 생성하지 않는다.
- Generator는 capability dependency/conflict, runtime/package/schema compatibility와 Production의 fake adapter 사용을 생성 전에 거절한다.
- 생성 결과에 manifest, generator version과 compatibility 기준을 보존한다.
- 생성 뒤 사용자 파일을 자동 덮어쓰지 않는다. 추가·변경은 dry-run, 예상 diff, package update와 migration guide를 우선한다.

지원 수준:

- Certified Profile: 전체 install/build/E2E를 검증한 preset
- Supported Composition: capability contract와 승인된 조합을 검증
- Experimental: 안정성·호환성 보장 범위를 명시한 선택

## Consequences

- 공통 수정은 하나의 Template과 package에 반영된다.
- 선택하지 않은 기능이 생성 프로젝트에 남지 않는다.
- 자유 조합 전체를 검증하지 않고 Certified Profile 중심으로 조합 폭증을 제한한다.
- Manifest schema와 compatibility 규칙 자체가 versioned public contract가 된다.
