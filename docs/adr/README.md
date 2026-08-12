# Cornerstone ADR Index

ADR은 장기간 유지되는 아키텍처 결정을 기록한다. 구현 순서와 현재 상태는 [`cornerstone_implementation_plan.md`](../cornerstone_implementation_plan.md)를 따른다.

상태:

- `Proposed`: 결정 전 검토 중
- `Accepted`: 구현이 따라야 하는 확정 계약
- `Superseded`: 새 ADR로 대체됨
- `Rejected`: 검토 후 채택하지 않음

| ADR                                          | 상태     | 결정                                                    |
| -------------------------------------------- | -------- | ------------------------------------------------------- |
| [ADR-0001](./0001-runtime.md)                | Accepted | Runtime과 TypeScript 지원 정책                          |
| [ADR-0002](./0002-package-boundaries.md)     | Accepted | Package boundary, export와 배포 형식                    |
| [ADR-0003](./0003-api-contract.md)           | Accepted | Nest DTO, OpenAPI, 오류와 동시성 계약                   |
| [ADR-0004](./0004-network-boundary.md)       | Accepted | Web/API origin, CORS, proxy와 cache 경계                |
| [ADR-0005](./0005-auth-session.md)           | Accepted | Cookie, CSRF, JWT, Session과 계정 복구 계약             |
| [ADR-0006](./0006-test-kernel.md)            | Accepted | Test와 CI Kernel                                        |
| [ADR-0007](./0007-migration-release.md)      | Accepted | PostgreSQL Migration, 배포와 rollback 계약              |
| [ADR-0008](./0008-supported-environments.md) | Accepted | Browser, OS, 보조기술과 responsive 지원 matrix          |
| [ADR-0009](./0009-distribution-trust.md)     | Accepted | Distribution, license와 artifact trust                  |
| [ADR-0010](./0010-identity-authorization.md) | Accepted | Identity lifecycle과 default-deny authorization         |
| [ADR-0011](./0011-web-platform.md)           | Accepted | 국제화, Metadata, Browser Security와 성능 예산          |
| [ADR-0015](./0015-project-composition.md)    | Accepted | Canonical Template과 Capability Manifest                |
| [ADR-0016](./0016-identity-scope.md)         | Accepted | Global Identity 기반 Single-tenant Core                 |
| [ADR-0017](./0017-release-gates.md)          | Accepted | Foundation·Standard·Production·Regulated·Extension Gate |

아직 문서가 없는 ADR-0012~0014는 구현 계획에 필요한 결정 주제로 먼저 등록되어 있다. 실제 선택이 승인되면 이 디렉터리에 개별 ADR을 만들고 `Accepted` 전에는 해당 진입 Gate를 통과한 것으로 간주하지 않는다.
