# ADR-0016: Global Identity 기반 Single-tenant Core

- Status: Accepted
- Date: 2026-08-12
- Owner: Backend owner

## Context

Tenant scope는 User unique index, Session, Role, ownership, cache, background job과 audit 구조를 바꾸는 데이터 아키텍처다. 프로젝트마다 첫 Migration에서 이를 선택하게 하면 동일 Starter version이 서로 다른 schema baseline을 갖게 된다.

## Decision

- Starter v1 `standard` Profile은 global `User` identity와 single-tenant application을 사용한다.
- Normalized email은 Core에서 global unique다.
- Core Role과 ownership은 application scope이며 사용하지 않는 nullable `tenantId`를 미리 추가하지 않는다.
- Tenant는 별도 capability와 schema baseline으로 제공한다.
- Tenant capability도 global `User`를 유지하고 `Tenant`와 `Membership`으로 tenant-scoped Role/status/authz version을 표현한다.
- Active Tenant는 route/subdomain 등 승인된 server context에서 해석하고 Client의 임의 header/body만 신뢰하지 않는다.
- Single-tenant에서 Tenant capability로 전환할 때는 expand/backfill/contract Migration과 cache/job/file/audit scope 전환을 제공한다.

## Consequences

- Core schema와 권한 모델이 단순하고 결정적이다.
- Single-tenant 프로젝트가 사용하지 않는 Tenant 추상화를 부담하지 않는다.
- Tenant는 runtime flag가 아니라 명시적 capability 적용과 Migration이 필요하다.
- 실제 프로젝트 반복으로 Tenant가 대부분의 기본 요구가 되면 별도 ADR로 Core 승격을 검토한다.
