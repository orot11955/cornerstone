# ADR-0009: Distribution과 Artifact Trust

- 상태: Accepted
- 결정일: 2026-08-12

## 결정

- Core `@cornerstone/*` package와 `create-cornerstone`은 synchronized version으로 release한다. Extension은 Core compatibility를 선언하는 독립 SemVer를 사용한다.
- 저장소와 공개 package는 `ISC`로 배포한다. 생성 프로젝트의 제품 license는 사용자 manifest가 선택하며 미선택 시 license를 임의 부여하지 않는다.
- package, canonical template와 생성 CLI는 build-once artifact를 staging하고 checksum을 포함한 release manifest로 연결한다.
- PR은 tarball external-consumer와 license policy를 검증한다. Release는 immutable commit SHA의 Action, 최소 권한, OIDC short-lived credential와 protected environment를 사용한다.
- Registry publish, signing과 production deploy는 서로 다른 principal로 실행한다. publish 전 provenance의 issuer, repository/ref, builder와 subject digest를 fail-closed로 검증한다.
- `latest` 같은 mutable alias는 편의용일 뿐 검증 근거가 아니다. Docs download는 version과 digest가 고정된 artifact를 가리킨다.
- overwrite가 필요한 생성 프로젝트 변경은 자동 적용하지 않고 versioned migration guide와 dry-run을 제공한다.

## 배포 전 외부 Gate

- npm scope 소유권, trusted publishing와 MFA 확인
- GitHub protected environment와 required reviewer 확인
- 실제 artifact storage/Docs origin/OIDC audience 확정
- signing·verification policy와 revoke 절차 rehearsal

외부 Gate가 해소되지 않은 상태에서는 local artifact만 만들 수 있고 공개 publish나 production-ready를 선언하지 않는다.
