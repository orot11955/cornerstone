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
- 임의 inline script, broad wildcard origin과 `unsafe-inline`은 허용하지 않는다. 개발용 `unsafe-eval`은 Production CSP에 포함하지 않는다.

## Frontend 관측

- Browser telemetry payload는 event type, route pattern, metric name/value, release와 correlation ID allowlist만 허용한다.
- URL query/hash, form value, DOM text, Cookie, token, email과 자유 형식 Error object를 수집하지 않는다.
- 기본 adapter는 no-op이고 provider가 명시적으로 구성된 경우에만 전송한다. sampling과 consent는 provider adapter 앞에서 적용한다.

## 성능 예산

- Foundation home route의 initial JavaScript 180 KiB gzip, route CSS 60 KiB gzip, self-hosted font 100 KiB를 기본 상한으로 둔다.
- LCP 2.5s, INP 200ms, CLS 0.1을 75 percentile 목표로 두되 실제 SLO는 Production provider와 traffic profile 승인 뒤 확정한다.
- 외부 font fetch를 build 조건으로 두지 않고 system font 또는 repository에 포함된 self-hosted font만 사용한다.
