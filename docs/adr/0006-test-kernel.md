# ADR-0006: Test와 CI Kernel

- Status: Accepted
- Date: 2026-08-12
- Owner: Test owner

## Context

Root `test`가 API unit만 실행하면서 성공하고 API E2E는 별도 실패하는 현재 구조로는 green 상태가 실제 검증 범위를 의미하지 않는다. package마다 아직 필요한 test 종류가 다르므로 명령, 참여 기준, 제외 사유와 실패 artifact 계약을 먼저 고정해야 한다.

## Decision

- Root는 `test:unit`, `test:component`, `test:integration`, `test:e2e`를 분리하고 `test`는 현재 필수인 unit/component/integration을 실행한다.
- 각 명령은 실행 전에 workspace별 참여 script와 명시된 제외 사유를 출력한다. 구현해야 할 runner가 없다는 이유만으로 암묵적으로 통과하지 않는다.
- Turbo task 이름은 Root 명령과 같게 유지하고 package는 해당 종류의 test가 있을 때 같은 이름의 script를 제공한다.
- API E2E와 향후 Root Playwright project는 `test:e2e`가 실행한다. E2E는 기본 `test`와 PR smoke에서 분리할 수 있지만 Standard release Gate에서는 필수다.
- CI와 로컬은 같은 package script를 사용하고 `lint`/`format:check`는 read-only, 수정 명령은 `lint:fix`/`format`으로 분리한다.
- Test DB와 filesystem fixture는 worker별로 격리하고 clock, random, network와 외부 service는 명시적으로 제어한다.
- 실패 artifact는 `.artifacts/<task>/` 아래에 저장하고 log, screenshot, trace, coverage와 fixture에서 secret·credential·개인정보를 제거한다.
- Turbo cache input에는 source, config와 lockfile을 포함하고 output은 실제 생성되는 coverage/artifact만 선언한다. Secret 값은 cache key나 artifact에 포함하지 않는다.
- PR smoke는 frozen install, format, lint, typecheck, unit과 build를 최소 권한·secret 없이 실행한다. Integration/E2E와 release 검증은 필요한 service와 보호된 환경을 별도 사용한다.

## Consequences

- Root 명령의 성공이 어떤 workspace와 test 종류를 검증했는지 확인할 수 있다.
- 아직 runner가 없는 영역은 명시적인 제외 상태로 남고 해당 Milestone에서 Gate로 승격된다.
- 신규 test 종류는 독자적인 CI 진입점을 만들지 않고 동일 Root 계약에 연결한다.
