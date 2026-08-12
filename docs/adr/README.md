# Cornerstone ADR Index

ADR은 장기간 유지되는 아키텍처 결정을 기록한다. 구현 순서와 현재 상태는 [`cornerstone_implementation_plan.md`](../cornerstone_implementation_plan.md)를 따른다.

상태:

- `Proposed`: 결정 전 검토 중
- `Accepted`: 구현이 따라야 하는 확정 계약
- `Superseded`: 새 ADR로 대체됨
- `Rejected`: 검토 후 채택하지 않음

| ADR                                       | 상태     | 결정                                                    |
| ----------------------------------------- | -------- | ------------------------------------------------------- |
| [ADR-0015](./0015-project-composition.md) | Accepted | Canonical Template과 Capability Manifest                |
| [ADR-0016](./0016-identity-scope.md)      | Accepted | Global Identity 기반 Single-tenant Core                 |
| [ADR-0017](./0017-release-gates.md)       | Accepted | Foundation·Standard·Production·Regulated·Extension Gate |

ADR-001~014는 구현 계획에 필요한 결정 주제로 먼저 등록되어 있다. 실제 선택이 승인되면 이 디렉터리에 개별 ADR을 만들고 `Accepted` 전에는 해당 진입 Gate를 통과한 것으로 간주하지 않는다.
