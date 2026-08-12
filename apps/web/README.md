# Cornerstone Web

Cornerstone의 Next.js Frontend 앱이다. 사용자 흐름과 SSR/CSR 경계를 담당하며 API의 인증·권한 검증을 대신하지 않는다.

현재는 기본 scaffold 단계다. 공통 API client, 인증 UI와 일반적인 제품 화면 대부분을 구성할 `packages/ui` 범용 UI Kit은 [구현 계획](../../docs/cornerstone_implementation_plan.md)에 따라 추가한다.

## 실행

Root에서 실행한다.

```bash
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web lint
pnpm --filter web typecheck
```

- 개발 URL: `http://localhost:3000`
- Production 실행: `pnpm --filter web start` (`build` 선행)
- Web 전용 test script는 아직 없다.

## 경계

- 재사용 token, Primitive, form, navigation, feedback, overlay, data display, layout과 composite pattern은 `packages/ui`가 소유한다.
- Responsive page composition과 Domain별 정보·action 우선순위는 앱이 소유한다.
- DOM, resize, focus 등 공용 browser hook은 승인된 `@cornerstone/ui/browser` subpath에서만 소비한다.
- HTTP 세부사항은 `packages/api-client`로 모은다.
- 프로젝트 Domain과 화면 조합은 앱이 소유한다.
- 사용자별 Query/Auth 상태를 서버 요청 간 공유하지 않는다.

## 문서

- [프로젝트 안내](../../README.md)
- [아키텍처와 디자인 시스템 계약](../../docs/cornerstone_assembly_diagram.md)
- [구현 계획](../../docs/cornerstone_implementation_plan.md)
- [ATLAS Industrial + Signal Violet 레퍼런스](../../docs/atlas-industrial-violet.html)
