# ADR-0008: 지원 환경과 접근성 검증 Matrix

- 상태: Accepted
- 결정일: 2026-08-12

## 지원 정책

Cornerstone Core UI는 다음 환경을 지원한다.

- Desktop: Chrome, Edge, Firefox의 최신 안정판과 직전 안정판, Safari의 최신 두 major
- Mobile: iOS/iPadOS Safari 최신 두 major, Android Chrome 최신 안정판과 직전 안정판
- 운영체제: 지원 브라우저 vendor가 보안 업데이트를 제공하는 Windows, macOS, iOS/iPadOS와 Android
- 입력: keyboard-only, pointer, touch, screen reader browse/form mode
- 보조기술 수동 기준: Windows NVDA + Chrome, macOS/iOS VoiceOver + Safari
- Layout 기준: viewport 320, 375, 768, 1024, 1440px와 component container 280, 480, 720px
- 확대: browser zoom 200%, text-only zoom 200%, reflow 400%
- 방향·언어: LTR/RTL, CJK와 영어 기준 길이의 3배인 번역 fixture
- 사용자 설정: `prefers-reduced-motion`, forced colors와 high contrast

브라우저 이름에 고정된 영구 version을 문서에 복제하지 않는다. 각 release manifest가 검증 당시 exact browser/OS/AT version을 evidence로 기록한다.

## 자동·수동 검증

- PR: SSR render, hydration, Chromium keyboard/axe, 320/768/1440px representative visual
- Nightly 또는 release candidate: Chromium, Firefox, WebKit의 responsive/a11y/visual matrix
- Release 수동 검사: NVDA/VoiceOver의 landmark, name/role/value, focus order와 announcement
- CSS 기능은 지원 matrix 전 범위에서 사용 가능하거나 progressive enhancement와 fallback이 있어야 한다.
- 자동 axe 통과만으로 WCAG 2.2 AA 충족을 선언하지 않는다. 수동 결과와 알려진 제약을 release evidence에 남긴다.

## Appearance와 Density

`Theme`, `Style`, `Brand`, `Density`는 서로 독립적인 축이다. Density는 정보나 기능을 제거하지 않고 hit target, focus order와 의미를 바꾸지 않는다. Server가 유효한 초기 Appearance를 HTML attribute로 출력하며 browser 저장값은 allowlist 검증 뒤에만 적용한다.

## 운영 항목

Hosting, registry, TLS 종료점, secret store, backup provider와 Production SLO/capacity는 이 지원 환경 결정과 분리한다. 해당 값이 승인되지 않으면 Foundation UI를 검증할 수는 있지만 Production Ready를 선언할 수 없다.
