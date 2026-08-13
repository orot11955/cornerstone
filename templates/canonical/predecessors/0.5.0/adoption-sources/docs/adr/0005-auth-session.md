# ADR-0005: 인증, Cookie와 Session 계약

- 상태: Accepted
- 결정일: 2026-08-13

## 인증 모델

- Core는 email/password와 server-side `AuthSession`을 사용한다. OAuth/MFA는 같은 Session port를 소비하는 Extension이며 Core release를 암묵적으로 변경하지 않는다.
- access token은 수명이 10분인 HS256 JWT, refresh token은 256-bit CSPRNG opaque value다. JWT만으로 현재 권한을 확정하지 않고 Session 상태와 `authzVersion`을 authoritative store에서 재검증한다.
- Core는 매 보호 요청에서 authoritative DB를 확인한다. 승인된 cache extension을 사용할 때 최대 stale 시간은 30초이며 revoke event로 즉시 무효화한다. cache/store 장애 시 인증·권한은 fail closed한다.
- register, verify/resend verification, login, me, refresh, logout, forgot/reset/change password, recent-auth와 active Session list/revoke를 하나의 lifecycle로 제공한다.

## Access JWT

- header는 `alg=HS256`, 승인된 `kid`, `typ=at+jwt`만 허용한다. 다른 algorithm, `none`, 알 수 없는 key와 중복/비정상 header를 거절한다.
- claim은 `iss=cornerstone-api`, `aud=cornerstone-web`, `sub` User ID, `sid` Session ID, `av` authzVersion, `iat`, `nbf`, `exp`, `jti`를 포함한다. 최대 clock skew는 30초다.
- 서명 key는 base64url decode 후 최소 32-byte이며 current N으로만 서명하고 N/N-1만 검증한다. current와 previous key, access key와 refresh/CSRF pepper는 모두 달라야 한다.
- Production은 승인된 secret provisioning metadata와 `kid`가 없는 key, placeholder/default 값, 형식 미달 값과 저장소에 추적된 값을 기동 시 거절한다.

## Refresh와 Session

- refresh 원문은 Cookie로 한 번만 반환하고 server에는 HMAC-SHA-256 hash, key version, family, generation, idle/absolute expiry와 revoke metadata만 저장한다.
- idle expiry는 7일, absolute expiry는 30일이다. refresh 성공은 이전 token을 atomic consume하고 generation을 증가시킨 새 token을 발급한다.
- 동일 generation의 concurrent 요청 중 하나만 성공한다. 이미 소비된 token의 재사용을 감지하면 해당 family 전체를 revoke하고 audit event를 남긴다.
- logout은 현재 Session, password/reset/email 변경과 User 정지·삭제는 모든 Session을 revoke한다. Role/permission/ownership 변경은 `authzVersion`을 증가시킨다.
- 개별/전체 Session revoke와 security-sensitive 변경은 commit 후 5초 이내 모든 replica가 기존 access/refresh를 거절해야 한다. Core DB 직접 검증은 즉시 반영을 목표로 한다.

## Cookie

| 이름                | 용도          | 속성                                                                         |
| ------------------- | ------------- | ---------------------------------------------------------------------------- |
| `__Host-cs_access`  | access JWT    | `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`                        |
| `__Host-cs_refresh` | refresh token | `Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`                 |
| `__Host-cs_csrf`    | CSRF token    | `Secure; SameSite=Strict; Path=/`; JavaScript가 header로 복사, HttpOnly 아님 |

- `Domain`은 설정하지 않는다. Production은 HTTPS가 아니면 Cookie를 발급하지 않는다. local 개발은 이름에서 `__Host-`를 제거한 별도 dev preset을 명시적으로 사용한다.
- 삭제 response는 발급 때와 같은 name/path/domain/SameSite/Secure 속성과 만료 시각을 사용한다. 같은 이름의 중복 Cookie나 모호한 parsing 결과를 거절한다.
- access/refresh/token 값을 response body, log, metric, trace, analytics와 test artifact에 포함하지 않는다.

## CSRF와 Origin

- Cookie 인증을 사용하는 모든 unsafe method는 exact canonical `Origin` 검사와 `X-CSRF-Token` 검사를 모두 통과해야 한다.
- CSRF token은 256-bit random 값과 Session 또는 pre-auth nonce를 server secret으로 서명한 값이다. readable Cookie와 header가 byte-for-byte 일치하고 서명이 유효한지 constant-time으로 비교한다.
- missing/`null`/malformed/spoofed Origin, missing/multiple token, cross-site `Sec-Fetch-Site`와 승인되지 않은 content type을 거절한다. `Referer`는 Origin이 없는 정상 browser 복구 신호로만 제한적으로 사용하며 Production unsafe request의 기본 우회가 아니다.
- login, register, recovery처럼 인증 전 상태 변경도 pre-auth CSRF와 account/IP rate limit을 적용한다. bearer/service 인증은 별도 scheme과 route로 분리하기 전 Cookie CSRF 예외를 만들지 않는다.

## Password, 검증과 복구

- password는 Argon2id를 사용하고 최소 12자, 최대 128 Unicode code point를 허용한다. blocklist/유출 password 검사는 provider port로 분리하며 임의 조합 규칙은 강제하지 않는다.
- Argon2 memory/time/parallelism은 지원 최소 Production class에서 login p95 목표를 만족하도록 benchmark한 값으로 release manifest에 기록하고, 더 낮은 parameter hash는 성공 login 뒤 갱신한다.
- Release 전 `pnpm --filter api benchmark:password`를 실행한다. 이 명령은 `apps/api/release/auth-password-policy.json`의 Argon2id parameter와 hash/verify p95 목표를 검증하고, 정책 digest·표본 수·p50/p95/max·runtime/OS/CPU 메타데이터만 JSON evidence로 출력한다. 기본 출력은 release evidence이며 `benchmark:password:fast`는 개발 확인용 `non-production-test` evidence이므로 release 증거로 사용할 수 없다.
- verification/recovery token은 purpose, User, expiry와 attempt count에 bind한 256-bit opaque value이며 원문 대신 hash만 저장한다. verification은 24시간, password reset은 30분, 최대 검증 실패는 5회다.
- token은 single-use다. purpose swap, replay와 만료를 거절하고 password reset 성공은 모든 Session revoke와 authzVersion 증가를 같은 transaction에서 수행한다.
- register/resend/forgot는 존재/부재 계정에 같은 status와 일반 message를 반환한다. response time 차이는 rate-limit queue와 일정한 작업 경계로 줄이며 provider 상태를 노출하지 않는다.
- Mail은 transaction outbox를 통해 전송한다. provider 실패가 User/token transaction을 되돌리거나 동일 token의 중복 효력을 만들지 않는다.

## Rate limit과 recent authentication

- credential, CSRF, refresh, verification/recovery와 Session 관리에는 endpoint별 account/IP/session key와 window를 적용한다. key에는 normalized identifier의 keyed hash를 사용하고 raw email/IP를 metric label로 쓰지 않는다.
- Core의 공유 rate-limit state는 PostgreSQL을 사용하고 atomic update한다. multi-replica에서 우회할 수 없어야 하며 store 장애 시 credential/recovery mutation은 `503`으로 fail closed한다.
- password/email 변경, 전체 Session revoke와 관리자 권한 변경은 최근 10분 안의 password 인증을 요구한다. access token 발급 시각만으로 recent-auth를 판정하지 않는다.

## 권한과 운영 사건

- `APP_GUARD` global default-deny를 적용하고 공개 route는 handler 단위 승인 allowlist만 허용한다. Controller-level `@Public`은 금지한다.
- User 상태, Session revoke, authzVersion, Role과 resource ownership을 모두 확인한다. client가 보낸 role/user/session/forwarded identity header를 신뢰하지 않는다.
- protected one-time admin bootstrap은 runtime server와 다른 entrypoint/principal로 실행하고 zero-admin DB에서 한 번만 성공한다. credential은 실행 뒤 폐기하고 runtime image에서 bootstrap artifact를 제외한다.
- login/refresh 실패, reuse, revoke, password/role/status 변경과 bootstrap은 secret/PII가 제거된 audit event를 남긴다. raw token/hash/password와 recovery code는 기록하지 않는다.

## 검증

- algorithm/key/type/issuer/audience/time claim, placeholder/equal/short key와 Cookie 발급·삭제 negative test를 유지한다.
- CSRF origin/token/content-type, Session fixation, duplicate Cookie와 forged identity matrix를 자동 검증한다.
- concurrent refresh, reuse family revoke, multi-replica rate limit과 모든 revoke 사건의 5초 SLA를 integration/E2E에서 검증한다.
- verification/reset replay·purpose swap·expiry·attempt limit, 존재/부재 응답 동등성과 outbox crash/replay를 검증한다.
- backup restore 뒤 global auth epoch/key rotation과 독립 revoke journal을 적용해 restore 이전 access/refresh가 모두 거절되는지 M9/M10에서 검증한다.
