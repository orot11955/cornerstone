# ADR-0015: Canonical Template과 Capability Manifest

- Status: Accepted
- Date: 2026-08-12
- Owner: Release owner

## Context

Cornerstone은 프로젝트마다 필요한 기반을 조합하는 Starter Kit이다. 기능 조합별 Template을 복제하면 보안 수정, 설정과 upgrade 경로가 서로 달라지고, 모든 기능을 항상 생성하면 사용하지 않는 코드·의존성·환경 변수를 제거해야 한다.

## Decision

- Template 원천은 하나의 canonical template만 유지한다.
- 프로젝트 생성 시 사용자 소유 `cornerstone.config.yml`의 capability manifest를 먼저 확정하고 선택된 코드·설정·의존성·환경 변수·인프라만 생성한다.
- `minimal`, `standard`, `production`, `regulated`는 별도 Template이 아니라 manifest preset이다.
- Profile은 기본 manifest로 먼저 확장하고 사용자가 승인한 override를 적용한다. Generator가 해석한 결과는 사용자 입력과 섞지 않고 `.cornerstone/manifest.lock.json`에 저장한다.
- 기본 Profile은 `standard`이며 Next.js, NestJS, Core UI, PostgreSQL/TypeORM과 password-session Auth를 포함한다.
- Queue, Tenant, Realtime, OAuth/MFA, Mail provider와 Object Storage는 명시적으로 선택하지 않으면 생성하지 않는다.
- `production`은 운영 요구를 활성화하는 preset이며 Mail, hosting, registry, secret store, backup 등 필수 provider slot이 해소되지 않으면 생성하지 않는다. Certified Production은 구체적인 provider/version 조합 단위로 검증한다.
- `regulated`는 compliance 인증이 아니라 `production` 위에 privacy/audit/residency/encryption 계약과 검증 harness를 추가하는 preset이다.
- Generator는 capability dependency/conflict, runtime/package/schema compatibility, 필수 provider 누락과 Production의 fake adapter 사용을 생성 전에 거절한다.
- `cornerstone.config.yml`과 lock manifest에는 secret·credential·개인정보 값을 저장하지 않고 환경 변수 이름이나 외부 secret reference만 기록한다.
- 생성 결과의 lock manifest에 resolved capability, generator/template/package version, schema baseline, compatibility 기준과 적용한 template/fragment checksum을 보존한다.
- 여러 capability가 공유 파일을 변경할 때는 파일별 단일 owner와 versioned structured composer를 사용한다. 적용 순서, dependency/env/module/route 충돌과 병합 결과는 결정적이어야 하며 임의 text patch를 public extension 계약으로 사용하지 않는다.
- Starter v1 Generator는 동일 release manifest에 포함된 bundled capability만 실행한다. 임의 remote plugin이나 신뢰하지 않은 Generator code 실행은 지원하지 않는다.
- 생성 뒤 사용자 파일을 자동 덮어쓰지 않는다. 추가·변경은 dry-run, 예상 diff, package update와 migration guide를 우선한다.

용어:

- Profile: 자주 사용하는 capability 선택 preset
- Capability: 사용자가 선택할 수 있는 기능 단위
- Adapter: capability의 기술 구현
- Provider: adapter가 연결하는 외부 서비스나 실행 환경
- Extension: Core와 독립 배포되는 optional capability

지원 수준:

- Certified Profile: exact runtime/package/provider matrix로 전체 install/build/E2E를 검증한 preset
- Supported Composition: capability contract와 승인된 조합을 검증
- Experimental: 안정성·호환성 보장 범위를 명시한 선택

## Consequences

- 공통 수정은 하나의 Template과 package에 반영된다.
- 선택하지 않은 기능이 생성 프로젝트에 남지 않는다.
- 자유 조합 전체를 검증하지 않고 Certified Profile 중심으로 조합 폭증을 제한한다.
- Manifest schema와 compatibility 규칙 자체가 versioned public contract가 된다.
- 사용자 의도, resolved 생성 이력과 공개 release metadata의 소유권이 분리된다.
