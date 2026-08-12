# ADR-0010: Identity Lifecycle과 Default-deny Authorization

- 상태: Accepted
- 결정일: 2026-08-13

## Identity와 상태

- Core는 ADR-0016의 global User와 single-tenant application을 사용한다. User ID는 UUID v4이며 timestamp 정렬을 ID에 의존하지 않는다.
- User 상태는 `pending_verification`, `active`, `suspended`, `deleted`다.
- 허용 전이는 `register → pending_verification → active`, `active ↔ suspended`, 모든 non-deleted 상태에서 `deleted`다. `deleted`는 terminal이며 복구 대신 새 User를 만든다.
- `pending_verification`과 `suspended`는 login/refresh와 보호 resource 접근을 거절한다. 검증/resend/recovery처럼 상태별로 승인된 endpoint만 허용한다.
- 모든 상태 변경은 이전/새 상태, actor, reason code, request/trace ID와 발생 시각을 audit event로 남긴다. free-form reason과 raw email/token을 audit payload에 넣지 않는다.

## Email 정규화와 재사용

- 입력은 Unicode NFKC, 앞뒤 whitespace 제거, 전체 lowercase 뒤 email syntax와 최대 254자를 검증한다. original casing을 별도 보안 식별자로 보존하지 않는다.
- normalized email은 non-deleted User 전체에서 global unique다. database unique index가 최종 경쟁 판정 원천이며 사전 조회만 믿지 않는다.
- unverified User는 7일 뒤 cleanup 대상이다. verification token 만료와 User cleanup은 분리하며 cleanup transaction 뒤 email을 다시 사용할 수 있다.
- 삭제 transaction은 normalized email을 `deleted+<userId>@users.invalid`로 대체하고 display name/profile과 Domain 개인정보를 익명화한 뒤 모든 Session/token을 revoke한다. commit 뒤 email 재사용을 허용한다.
- 중복 가입·복구 response는 기존 User 존재와 상태를 노출하지 않는다. 내부 unique conflict는 공개 `409` 대신 auth endpoint의 일반 accepted 응답과 outbox 정책에 따라 처리한다.

## Role, permission과 ownership

- Core Role은 `user`, `admin` 두 개다. 가입 기본값은 `user`이며 `admin`은 protected bootstrap 또는 현재 admin의 명시적 권한 변경만 가능하다.
- authorization의 실제 입력은 server가 읽은 User status, Session, `authzVersion`, Role과 resource ownership이다. body/query/header의 `userId`, `role`, `status`, `ownerId`를 principal로 신뢰하지 않는다.
- permission은 `resource:action` 형태의 closed registry다. Role→permission mapping은 version control하며 endpoint가 raw Role 문자열을 직접 비교하지 않는다.
- ownership endpoint는 service가 resource를 authoritative repository에서 읽고 `ownerId === principal.userId`를 검사한다. 목록 query에도 owner scope를 repository 조건으로 강제하며 가져온 뒤 filtering하지 않는다.
- 다른 사용자의 존재를 숨겨야 하는 ownership resource는 `404`, resource 존재를 공개해도 되는 명시적 permission 부족은 `403`을 반환한다. 인증 부재·무효 Session은 항상 `401`이다.
- 본인 Role/status/authzVersion/ownerId 변경, 임의 DTO spread와 Entity 직접 patch를 금지한다. Mapper는 승인 field allowlist만 적용한다.

## Default-deny route 정책

- `APP_GUARD`가 모든 HTTP route를 기본 거절한다. 각 handler는 정확히 하나의 분류를 가져야 한다: `public`, `authenticated`, `permission`, `ownership`.
- `@Public`은 handler에만 허용하고 Controller-level 사용을 CI가 거절한다. decorator metadata만으로 열리지 않으며 `config/authorization-matrix.yml`의 method, normalized path, reason code와 owner가 일치해야 한다.
- public Core allowlist는 health live/ready, register, verification/resend, login, refresh와 forgot/reset password만 포함한다. 실제 method/path는 M4 snapshot과 함께 고정한다.
- `authenticated`는 현재 active User와 Session, `permission`은 closed permission registry, `ownership`은 service/repository scope를 추가 검증한다.
- route inventory는 Nest metadata에서 생성하고 authorization matrix, OpenAPI security와 실제 Guard 결과를 비교한다. 미분류·중복 분류·고아 matrix·Controller-level public route가 하나라도 있으면 CI가 실패한다.
- GraphQL, WebSocket, job/admin CLI를 추가하면 별도 inventory와 동일 default-deny 원칙이 필요하며 HTTP public metadata를 재사용해 우회하지 않는다.

## `authzVersion`과 revoke SLA

- User row의 non-negative integer `authzVersion`이 authoritative source다. Role, status, password, permission/ownership policy와 전체 Session revoke 시 transaction 안에서 증가한다.
- access JWT의 `av`와 현재 User 값을 비교하고 AuthSession의 revoke/expiry도 확인한다. Core는 매 보호 요청에서 PostgreSQL을 읽어 즉시 판정한다.
- cache extension은 최대 30초 TTL과 revoke event invalidation을 모두 적용한다. store/cache 장애 시 fail closed하며 stale 권한으로 진행하지 않는다.
- logout/개별 Session revoke는 해당 Session, password/Role/status/permission/ownership/delete는 관련 전체 Session 또는 authzVersion을 commit 시점에 변경한다. 모든 replica의 거절 SLA는 5초 이하다.
- `suspended`와 `deleted`는 access/refresh 모두 거절한다. 다시 active가 되어도 기존 Session을 되살리지 않고 새 login을 요구한다.

## 삭제, backup restore와 보존

- 삭제 시 개인정보 익명화, Session/token revoke, authzVersion 증가, outbox/audit와 외부 삭제 journal 기록을 한 transaction 또는 원자적 outbox 경계에 둔다.
- revoke·삭제·Role/status 변경 journal은 복원 대상 DB와 독립된 append-only 저장소에도 전달한다. event에는 opaque User/Session ID, event type/version과 시각만 두고 raw 개인정보를 넣지 않는다.
- backup restore 뒤 journal을 backup 시점부터 재적용하고 global auth epoch를 증가시킨 뒤 access signing key를 전환한다. restore 전 access JWT와 refresh/session을 모두 거절한 뒤 traffic을 연다.
- Core runtime DB의 operational User/Session/token은 삭제·expiry cleanup한다. 법적 보존, data export/delete와 Domain 개인정보 보존은 ADR-0013/regulated capability가 기간과 예외를 구체화한다.

## Admin bootstrap

- zero-admin DB에서 protected one-time job만 첫 admin을 만든다. runtime HTTP API와 app runtime DB principal에는 bootstrap 권한을 주지 않는다.
- bootstrap input은 secret store의 단기 reference와 normalized email이며 password/token 원문을 CLI argument나 log에 남기지 않는다.
- PostgreSQL advisory lock과 bootstrap marker로 concurrent/두 번째 실행을 거절하고, 성공 뒤 credential을 폐기한다. bootstrap artifact는 runtime image에서 제외한다.
- 이후 admin 변경도 `admin:manage` permission, recent-auth와 audit를 요구하고 마지막 active admin 제거를 거절한다.

## 데이터 계약

- 모든 identity/auth row는 UUID v4 primary key, `createdAt`/`updatedAt` UTC `timestamptz(3)`와 non-negative integer `version`을 사용한다.
- optimistic update는 `version`을 비교·증가시키고 ADR-0003의 strong ETag/`If-Match`를 사용한다.
- User response에는 ID, 상태별 공개 가능 profile, version과 timestamp만 mapper로 노출한다. 본인/승인된 admin response만 normalized 값을 `email`로 제공하고 Role도 같은 권한 범위에서만 제공한다. password hash, token/session hash, authzVersion 내부 값과 삭제 metadata는 모든 response에서 제외한다.

## 검증

- 모든 상태 전이와 금지 전이, global email unique 경쟁, unverified cleanup, 삭제 후 재사용과 token/Session 불부활을 검증한다.
- anonymous, suspended/deleted, cross-user, forged owner/role/status와 self elevation을 route/service/repository 각 경계에서 거절한다.
- route inventory와 matrix drift, Controller-level public, 미분류 신규 route와 OpenAPI security 불일치를 CI negative fixture로 검증한다.
- Role/status/password/ownership/delete와 Session revoke가 multi-replica 5초 SLA 안에 access/refresh를 거절하는지 검증한다.
- concurrent bootstrap, 두 번째 실행, 마지막 admin 제거와 runtime image/bootstrap credential 비잔존을 검증한다.
- restore rehearsal에서 journal/auth epoch/key transition 뒤 restore 이전 access/refresh가 모두 거절되고 삭제 email/profile이 부활하지 않는지 확인한다.
