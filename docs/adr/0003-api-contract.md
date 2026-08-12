# ADR-0003: API와 OpenAPI 계약

- 상태: Accepted
- 결정일: 2026-08-13

## 공개 경계

- HTTP API는 `/api/v1` major path를 사용한다. 호환되는 필드 추가는 같은 major에서 허용하고 의미 변경·필드 제거는 새 major와 migration 기간이 필요하다.
- Nest request/response DTO와 그 validation metadata가 endpoint 계약의 원천이다. TypeORM Entity를 response로 직렬화하지 않는다.
- `packages/schemas`는 email, ID, timestamp와 pagination처럼 transport-independent한 값만 소유한다. HTTP DTO를 수동 복제하지 않는다.
- build가 `apps/api/openapi/openapi.json`을 생성하고, 해당 snapshot에서 `packages/api-client/src/generated`를 생성한다. 두 artifact의 diff가 남으면 CI가 실패한다.
- OpenAPI generator 설정은 `packages/api-client/openapi.config.ts`, snapshot/client 생성·검사 명령은 Root가 소유한다. 생성 파일을 직접 수정하지 않는다.

## Wire 형식

- ID는 UUID 문자열, timestamp는 UTC RFC 3339 instant(`YYYY-MM-DDTHH:mm:ss.sssZ`)로 전송한다. 표시 timezone은 consumer 책임이다.
- JSON request는 선언한 field 외 값을 거절한다. optional과 nullable을 구분하고 `undefined`를 wire 값으로 취급하지 않는다.
- 목록은 1부터 시작하는 `page`, `pageSize`와 endpoint별 enum `sort`를 사용한다. `pageSize` 기본값은 20, 최대값은 100이다.
- 목록 response는 `{ items, page, pageSize, total }`이다. 대규모/실시간 Domain이 cursor를 요구하면 별도 계약과 이름을 사용하고 두 방식을 한 endpoint에 섞지 않는다.
- 성공 body가 없는 요청은 `204`를 반환한다. `401`은 authentication 부재·실패, `403`은 인증된 principal의 권한 부족, `409`는 현재 상태·idempotency 충돌, `412`는 `If-Match` 불일치다.

## 오류

- 모든 비정상 response는 `{ error: { code, message, requestId, details? } }` 형식이다.
- `code`는 문서화된 stable machine code, `message`는 안전한 일반 설명, `requestId`는 server가 검증·생성한 correlation ID다.
- `details`는 field validation처럼 공개가 승인된 구조만 허용한다. stack, SQL, 내부 URL, Cookie, token, password, raw provider error와 사용자 존재 여부를 포함하지 않는다.
- 예상 가능한 Domain 오류와 일시적 오류를 code/status로 구분한다. client는 임의 message text를 분기 조건으로 사용하지 않는다.

## 멱등성과 동시성

- retry 가능한 mutation은 `Idempotency-Key`를 받는다. key는 1~128자의 불투명 ASCII 값이며 scope는 authenticated actor(또는 anonymous rate-limit subject), HTTP method와 normalized route다.
- server는 canonical payload SHA-256, 상태, response와 생성 시각을 24시간 보존한다. 같은 key와 같은 payload는 저장한 결과를 재생하고 다른 payload는 `409 IDEMPOTENCY_KEY_REUSED`로 거절한다.
- 처리와 idempotency 결과 저장, DB 변경과 outbox 기록은 같은 transaction 경계에 둔다. concurrent duplicate 중 하나만 실행한다.
- 수정 가능한 resource는 정수 `version`과 strong ETag를 제공한다. mutation은 `If-Match`를 요구하고 불일치는 `412 VERSION_MISMATCH`다.
- 자동 retry는 GET/HEAD와 명시적 idempotency key가 있는 mutation의 일시적 transport/`429`/승인된 `5xx`에만 적용한다. 전체 backoff budget과 `Retry-After`를 우선하며 abort/timeout을 소비자까지 전달한다.

## 검증과 변경 관리

- OpenAPI snapshot test, generated client diff, response contract test와 breaking-change diff를 PR Gate로 둔다.
- DTO field 추가도 consumer가 strict parser를 쓸 수 있으므로 변경 기록과 generated client 검증이 필요하다.
- deprecated API는 OpenAPI에 표시하고 최소 한 minor migration 기간과 대체 경로를 제공한 뒤 major에서 제거한다.
- OpenAPI와 실제 Guard의 global security, 공개 route, `401/403` 동작이 다르면 release를 차단한다.
