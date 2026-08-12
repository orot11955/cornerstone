# ADR-0004: Web/API Network 경계

- 상태: Accepted
- 결정일: 2026-08-13

## 배포 topology

- Browser의 canonical API URL은 Web과 같은 public origin의 `/api/v1`이다. Production ingress가 `/api/*`를 Nest API service로 전달하고 그 외 경로를 Next Web service로 전달한다.
- Browser에 internal service DNS, container port와 provider URL을 노출하지 않는다. TLS는 승인된 ingress/CDN에서 종료하고 upstream 연결 정책과 HSTS는 운영 계약으로 검증한다.
- Server Component와 승인된 Next server adapter는 server-only `INTERNAL_API_URL`로 Nest를 호출한다. browser bundle에는 상대 `/api/v1`만 포함한다.
- local 개발에서 Web `http://localhost:3000`이 API `http://localhost:4000`을 직접 호출할 때만 exact CORS allowlist를 사용한다. wildcard origin, origin reflection과 `*` credentials를 금지한다.

## 실행 context

| Context               | API 주소                     | Cookie/identity 전달                                       | Cache                       |
| --------------------- | ---------------------------- | ---------------------------------------------------------- | --------------------------- |
| Browser               | same-origin `/api/v1`        | browser가 host-only Cookie를 `credentials: include`로 전송 | auth/user response no-store |
| Server Component      | server-only internal origin  | 현재 request의 승인된 auth/CSRF Cookie만 명시적으로 전달   | request-scoped, no-store    |
| Route Handler/BFF     | endpoint별 고정 adapter      | 승인 Cookie/header allowlist만 전달                        | 기본 no-store               |
| Public anonymous data | public 또는 internal API URL | identity 전달 없음                                         | endpoint 계약에만 따름      |

- Server request 간 API client, Query cache, Cookie와 principal을 module global state에 저장하지 않는다.
- 인증·사용자 response에 Next shared cache, ISR, public CDN cache를 사용하지 않는다. 공개 cache는 endpoint가 `Cache-Control`과 invalidation 책임을 명시한 경우에만 허용한다.

## Proxy와 CORS

- Next는 arbitrary URL을 받는 generic proxy를 제공하지 않는다. 각 Route Handler/Server Action은 고정 method/path, request schema, timeout, response-size와 redirect 정책이 있는 adapter만 사용한다.
- Browser가 보낸 `Authorization`, `Cookie`, `Host`, `Origin`, `Forwarded`, `X-Forwarded-*`, `X-User-*`를 internal 요청으로 그대로 복사하지 않는다.
- API는 exact `WEB_URL` origin 하나 이상을 정규화해 비교한다. credential request에는 일치하는 `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`와 `Vary: Origin`을 반환한다.
- `null`, malformed, user-info 포함, suffix/prefix spoofing과 승인되지 않은 scheme/port origin을 거절한다. preflight의 method/header도 endpoint allowlist로 제한한다.
- redirect를 자동 추적하지 않는 outbound adapter를 기본으로 하고 loopback, private, link-local, metadata 주소와 DNS 재해석을 차단한다. 응답 크기와 전체 timeout budget을 제한한다.

## Trusted proxy와 client IP

- 기본값은 proxy를 신뢰하지 않는 것이다. Production은 ingress hop 수 또는 CIDR을 환경별로 정확히 고정한 경우에만 Express trust proxy를 활성화한다.
- rate limit, audit와 secure-cookie 판단은 검증된 client IP/scheme만 사용한다. 신뢰 경계 밖의 forwarding header는 삭제한다.
- request ID는 API가 허용 형식을 검증한 값만 계승하고 그 외에는 새 CSPRNG ID를 만든다. identity/role header는 외부 입력으로 신뢰하지 않는다.

## 실패와 관측

- Browser/SSR client는 AbortSignal과 전체 timeout budget을 전달한다. mutation은 ADR-0003의 idempotency 계약 없이는 자동 retry하지 않는다.
- API 연결 실패, timeout과 circuit open을 공개 error code로 정규화하고 raw internal origin/provider error를 response에 포함하지 않는다.
- route template, method, status class와 latency만 metric label로 사용한다. 전체 URL, query, Cookie와 동적 ID는 label/log에 넣지 않는다.
- ingress/API/Web 각각 readiness와 correlation을 제공하되, 하나의 service 장애가 다른 service의 민감 상태를 노출하지 않는다.

## 검증

- same-origin Production 경로와 local exact-CORS의 허용/거부/preflight matrix를 자동 검증한다.
- 사용자 A/B/anonymous의 SSR/CSR response, Cookie와 cache가 섞이지 않는 fixture를 유지한다.
- forged forwarding/identity header, open redirect, private address, redirect/DNS 재해석과 oversized response negative test를 실행한다.
- 배포 전 canonical origin, TLS 종료, trusted proxy hop과 Cookie host가 실제 ingress topology와 일치하는지 확인한다.
