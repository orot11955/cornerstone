# ADR-0011: Web Platform Foundation

- 상태: Accepted
- 결정일: 2026-08-12

## 국제화

- Core locale은 `ko`, `en`이며 기본 locale은 `ko`다. Domain이 지원 locale을 확장할 수 있다.
- locale, timezone과 currency는 request 단위 값이며 module global mutable state로 저장하지 않는다.
- translation key는 `namespace.path` 형식이고 누락 시 기본 locale, 그다음 key 자체로 fallback한다. 누락 key는 개발·관측 환경에서만 식별자를 기록한다.
- `<html lang dir>`는 서버에서 결정한다. `ar`, `fa`, `he`, `ur` 계열은 RTL로 판정하며 hydration 뒤 방향을 뒤집지 않는다.
- wire timestamp는 UTC ISO instant이며 표시할 때만 명시적 timezone/locale을 적용한다.

## Metadata와 오류

- canonical origin은 server-only `SITE_URL` 하나로 고정하고 Production에서 HTTPS가 아니면 기동을 거절한다.
- Root가 title template, description, canonical, robots와 social metadata 기본값을 소유하고 route가 Domain 값만 확장한다.
- `robots.ts`, `sitemap.ts`, `not-found.tsx`, route `error.tsx`와 `global-error.tsx`를 별도 경계로 둔다.
- 예상 가능한 Domain 오류는 page 안에서 설명하고 retry/수정 행동을 제공한다. 예기치 않은 오류는 correlation ID만 사용자에게 노출하며 stack, query와 입력값을 노출하지 않는다.

## Browser Security

- Next `proxy.ts`가 request마다 CSPRNG nonce를 생성하고 strict CSP를 request/response에 동일하게 적용한다.
- `default-src 'self'`, nonce 기반 `script-src`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`를 기본으로 한다.
- `X-Content-Type-Options: nosniff`, strict Referrer Policy와 최소 Permissions Policy를 모든 HTML response에 적용한다.
- HSTS는 TLS를 실제 종료하는 Production ingress/CDN 책임이며 HTTPS 검증 뒤에만 활성화한다.
- inline script와 style element, broad wildcard origin에는 `unsafe-inline`을 허용하지 않는다. typed component layout 변수가 사용하는 React `style` attribute에 한해 `style-src-attr 'unsafe-inline'`을 허용하며 사용자 입력을 style 값으로 전달하지 않는다.
- 개발용 `unsafe-eval`은 Production CSP에 포함하지 않는다.

## Frontend 관측

- Browser telemetry payload는 event type, route pattern, metric name/value, release와 correlation ID allowlist만 허용한다.
- URL query/hash, form value, DOM text, Cookie, token, email과 자유 형식 Error object를 수집하지 않는다.
- 기본 adapter는 no-op이고 provider가 명시적으로 구성된 경우에만 전송한다. sampling과 consent는 provider adapter 앞에서 적용한다.

## API와 인증 실행 경계

- Production Browser는 same-origin 상대 `/api/v1`만 호출한다. 범용 Next proxy/BFF와 caller가 지정하는 upstream URL은 제공하지 않는다.
- Server Component는 server-only `INTERNAL_API_URL`과 고정 endpoint를 사용하며, 원본 Cookie/header를 전달하지 않고 중복되지 않은 승인 auth Cookie만 재구성한다.
- SSR QueryClient는 request-scoped이고 auth/user/session query는 dehydrate 또는 persistent cache 대상이 아니다.
- Browser의 자동 refresh와 원 요청 재시도는 `GET /auth/me`, `GET /auth/sessions`에 한해 1회 허용한다. 상태 변경 요청은 자동 재시도하지 않는다.
- 같은 tab은 공유 Promise, 지원 Browser의 여러 tab은 Lock Manager로 refresh를 직렬화한다. Lock Manager가 없는 환경의 다중 tab 경쟁은 fail-secure 가용성 제한으로 기록한다.
- Verify/reset 메일 deep link는 `#token=<percent-encoded-token>`만 사용한다. 화면은 fragment를 읽은 즉시 `history.replaceState`로 제거하며 query token은 거절한다. Mail adapter/template도 같은 형식을 사용해야 한다.
- Production ingress는 `/api/v1`을 고정 API upstream으로 전달하고 spoof 가능한 identity, authorization, forwarded header를 신뢰하지 않는다.

## 성능 예산

- Foundation home route의 initial JavaScript 180 KiB gzip, route CSS 60 KiB gzip, self-hosted font 100 KiB를 기본 상한으로 둔다.
- LCP 2.5s, INP 200ms, CLS 0.1을 75 percentile 목표로 두되 실제 SLO는 Production provider와 traffic profile 승인 뒤 확정한다.
- 외부 font fetch를 build 조건으로 두지 않고 system font 또는 repository에 포함된 self-hosted font만 사용한다.
