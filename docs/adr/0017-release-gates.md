# ADR-0017: 계층화된 Release Gate

- Status: Accepted
- Date: 2026-08-12
- Owner: Release owner

## Context

Package Foundation, 기본 Starter, Production 운영과 규제 대응을 하나의 v1 완료 조건에 묶으면 처음 사용할 수 있는 release가 지나치게 늦어진다. 반대로 Gate를 약화하면 `production-ready`라는 표현을 신뢰할 수 없다.

## Decision

- Foundation Release는 workspace/tooling, shared package, UI Foundation과 외부 소비 검증을 완료한다.
- Standard Starter Release는 기본 Certified Profile의 Web/API/Data/Auth/Core UI와 local/CI E2E를 완료한다.
- Production Ready Release는 image, Migration 배포, 관측, SLO 선언, load/restore, provenance와 incident rehearsal을 완료한다.
- Regulated Profile은 compliance를 보증하지 않고 data classification, consent, export/delete, residency, encryption과 audit를 구현·검증할 Foundation을 제공한다.
- Extension Release는 활성 capability별 독립 Gate와 compatibility 범위를 사용하며 Core release를 차단하지 않는다.
- Core package는 synchronized release를 사용하고 Extension package는 독립 SemVer와 지원 Core 범위를 선언한다.
- 기능별 Gate는 해당 capability가 활성화될 때 필수다. 입력 검증, secret scan, default-deny, build 재현성과 artifact integrity 같은 공통 보안 Gate는 모든 Profile에서 유지한다.
- Cross-layer 검증은 Standard Core E2E, Production load/restore/SLO, Regulated privacy/audit와 Extension contract로 분리한다. 상위 Profile 검증이 Foundation이나 Standard release를 차단하지 않는다.
- Docs preview는 package/API/UI 변경과 함께 배포하고 stable Docs만 검증된 artifact publish 후 version manifest로 공개한다.

## Consequences

- Foundation과 Standard Starter를 Production 전체보다 먼저 사용할 수 있다.
- `standard`, `production`, `regulated`의 보장 범위를 명확히 구분한다.
- SLO·residency 같은 프로젝트 값은 Starter가 고정하지 않고 schema, 기본값, harness와 검증 방법을 제공한다.
- 각 release artifact와 Docs는 자신이 통과한 Gate를 machine-readable manifest에 기록한다.
