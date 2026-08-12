# Cornerstone Identity Data Contract v1

> 상태 전이와 authorization 원칙: [ADR-0010](./adr/0010-identity-authorization.md)
>
> Identity scope: [ADR-0016](./adr/0016-identity-scope.md)
>
> Migration 규칙: [ADR-0007](./adr/0007-migration-release.md)

이 문서는 M3 첫 Migration의 table, column, relation, index와 retention 입력을 고정한다. TypeORM Entity나 공개 DTO가 원천이 아니며 변경 시 ADR·Migration·OpenAPI 영향 검토가 필요하다.

## 공통 규칙

- ID: application이 생성한 UUID v4, PostgreSQL `uuid`
- 시각: UTC instant, PostgreSQL `timestamptz(3)`
- optimistic version: `integer NOT NULL DEFAULT 0 CHECK (version >= 0)`
- enum 성격 값: 향후 expand가 가능한 `varchar` + named check constraint
- email: NFKC → trim → lowercase, `varchar(254)`; application과 DB unique conflict를 모두 처리
- secret/token/password 원문은 DB, log, audit와 outbox에 저장하지 않음
- Core에는 `tenant_id`, Membership과 암묵적 tenant filter를 만들지 않음

## `users`

| Column              | Type             | Null | 의미                                           |
| ------------------- | ---------------- | ---- | ---------------------------------------------- |
| `id`                | `uuid`           | no   | PK                                             |
| `email_normalized`  | `varchar(254)`   | no   | global unique, deleted 시 reserved 값으로 대체 |
| `password_hash`     | `varchar(255)`   | yes  | Argon2id encoded hash, 삭제 시 null            |
| `status`            | `varchar(32)`    | no   | pending_verification/active/suspended/deleted  |
| `role`              | `varchar(32)`    | no   | user/admin                                     |
| `authz_version`     | `integer`        | no   | non-negative, 권한 사건에서 증가               |
| `version`           | `integer`        | no   | optimistic concurrency                         |
| `email_verified_at` | `timestamptz(3)` | yes  | verification 완료                              |
| `suspended_at`      | `timestamptz(3)` | yes  | status와 함께 consistency check                |
| `deleted_at`        | `timestamptz(3)` | yes  | terminal deletion 시각                         |
| `created_at`        | `timestamptz(3)` | no   | 생성                                           |
| `updated_at`        | `timestamptz(3)` | no   | 변경                                           |

Index/constraint:

- unique `users_email_normalized_uq(email_normalized)`
- check status/role registry, non-negative `authz_version/version`
- check deleted이면 `deleted_at IS NOT NULL AND password_hash IS NULL`, 그 외 `deleted_at IS NULL`
- index `(status, created_at)`는 unverified cleanup과 운영 조회에 사용
- 마지막 admin 규칙은 row check가 아니라 advisory lock을 잡은 service transaction에서 검증

## `auth_sessions`

| Column                  | Type             | Null | 의미                             |
| ----------------------- | ---------------- | ---- | -------------------------------- |
| `id`, `family_id`       | `uuid`           | no   | PK, refresh family               |
| `user_id`               | `uuid`           | no   | users FK, delete restrict        |
| `current_generation`    | `integer`        | no   | 0 이상                           |
| `device_label`          | `varchar(120)`   | yes  | server allowlist로 생성한 표시값 |
| `last_password_auth_at` | `timestamptz(3)` | no   | 해당 Session의 recent-auth 기준  |
| `last_seen_at`          | `timestamptz(3)` | no   | Session 목록/idle 판단           |
| `idle_expires_at`       | `timestamptz(3)` | no   | 최대 7일                         |
| `absolute_expires_at`   | `timestamptz(3)` | no   | 생성부터 최대 30일               |
| `revoked_at`            | `timestamptz(3)` | yes  | revoke 시각                      |
| `revoke_reason`         | `varchar(64)`    | yes  | closed reason code               |
| `version`, timestamps   | 공통             | no   | optimistic update                |

- index `(user_id, revoked_at, absolute_expires_at)`, unique `family_id`
- User를 물리 삭제하지 않으므로 FK는 `ON DELETE RESTRICT`
- expiry/revoke 90일 뒤 operational Session row를 cleanup하며 audit/delete journal은 별도 정책을 따름

## `auth_refresh_tokens`

| Column             | Type             | Null | 의미                        |
| ------------------ | ---------------- | ---- | --------------------------- |
| `id`, `session_id` | `uuid`           | no   | PK, AuthSession FK cascade  |
| `generation`       | `integer`        | no   | Session 안에서 증가         |
| `token_hash`       | `char(64)`       | no   | HMAC-SHA-256 hex            |
| `key_version`      | `varchar(64)`    | no   | refresh pepper version      |
| `expires_at`       | `timestamptz(3)` | no   | token expiry                |
| `consumed_at`      | `timestamptz(3)` | yes  | rotation에서 atomic consume |
| `revoked_at`       | `timestamptz(3)` | yes  | family/session revoke 전파  |
| `created_at`       | `timestamptz(3)` | no   | 생성                        |

- unique `token_hash`, unique `(session_id, generation)`
- consume는 `consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()` 조건 update의 affected row가 1일 때만 성공
- 이미 consumed token 사용은 reuse 사건이며 family 전체 revoke

## `auth_action_tokens`

- `id`, `user_id`, `purpose(verify_email|reset_password)`, `token_hash char(64)` unique, `key_version`, `attempt_count`, `max_attempts`, `expires_at`, `consumed_at`, `revoked_at`, `created_at`
- unique active token은 partial unique `(user_id, purpose) WHERE consumed_at IS NULL AND revoked_at IS NULL`
- purpose/expiry/attempt 조건을 atomic update하고 single-use로 소비
- consumed/expired 30일 뒤 cleanup

## 운영 보조 table

### `idempotency_records`

- 전용 secret으로 HMAC한 actor scope와 client key, method, route ID, payload SHA-256, state(pending/completed), response status/body allowlist, resource version, expires와 timestamps
- unique `(scope_hash, key, method, route_id)`, TTL 24시간
- Domain mutation/outbox와 reserve/complete를 같은 transaction에서 처리하고 동일 payload만 replay
- Cookie/token을 발급하는 auth endpoint에는 적용하지 않고 response allowlist에도 Cookie, token, password와 개인정보를 저장하지 않음
- `IDEMPOTENCY_SECRET`은 기존 record의 최대 24시간 TTL이 끝날 때까지 그대로 유지한 뒤 전환하며, 조기 교체는 기존 replay 포기를 명시한 maintenance window에서만 수행

### `rate_limit_buckets`

- keyed subject hash, policy ID, window start, count와 expiry
- unique `(subject_hash, policy_id, window_start)`, raw email/IP 미저장, expiry 뒤 최대 48시간 내 cleanup

### `outbox_events`

- UUID, type/version, aggregate ID, allowlisted JSON payload, attempts, available/locked/processed 시각, error code와 timestamps
- partial index `(available_at, created_at) WHERE processed_at IS NULL`, lease와 `SKIP LOCKED` 사용
- processed 30일, poison event 90일 기본 보존 후 project policy로 조정

### `audit_events`

- UUID, event type/version, opaque actor/subject/resource ID, outcome/reason code, request/trace ID, allowlisted JSON metadata와 occurred/recorded 시각
- update/delete를 runtime principal에 허용하지 않는 append-only table
- raw email/IP/token/hash/password와 free-form error를 금지
- Foundation 기본 보존 365일이며 project가 ADR-0013 data policy로 줄이거나 법적 보존을 명시하기 전 무기한을 가정하지 않음

## 삭제와 restore

삭제 transaction은 다음을 원자적으로 수행한다.

1. User email을 `deleted+<uuid>@users.invalid`, password/profile을 null/익명값, Role을 `user`로 변경
2. status/deletedAt/version/authzVersion 변경
3. 모든 Session/refresh/action token revoke
4. delete audit와 외부 delete/revoke journal용 outbox 기록

Backup restore 뒤 traffic 전에는 독립 journal 재적용, global auth epoch 증가와 signing key transition을 완료한다. restore된 `deleted` User를 active로 전환하거나 reserved email을 원본으로 되돌리지 않는다.

## M3 acceptance 입력

- 위 column/index/check/FK가 첫 expand Migration과 Entity에 일치
- `synchronize=false`, empty DB forward/revert/forward와 schema drift 0
- email unique/concurrent register, refresh atomic consume/reuse, action token single-use와 idempotency 경쟁 test
- User delete transaction rollback/commit, outbox 포함 여부와 operational retention cleanup test
- single-tenant schema에 `tenant_id`/Membership 0건
