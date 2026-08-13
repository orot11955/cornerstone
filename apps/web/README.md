# Cornerstone Web

Cornerstone의 Next.js Frontend 앱이다. 사용자 흐름과 SSR/CSR 경계를 담당하며 API의 인증·권한 검증을 대신하지 않는다.

공통 UI Foundation과 Web Platform 경계를 실제 consumer로 검증하는 reference app이다.

## 환경 설정

```bash
cp apps/web/.env.example apps/web/.env.local
```

`SITE_URL`은 metadata, sitemap과 canonical URL의 기준이다. `pnpm --filter web start`로 Production 서버를 시작할 때는 HTTPS origin이어야 하며 credential, query와 hash를 포함할 수 없다.

`INTERNAL_API_URL`은 Server Component가 사용하는 server-only Nest origin이다. Browser는 Production에서 같은 origin의 `/api/v1`만 호출하며, 개발 서버에서만 이 경로를 `INTERNAL_API_URL`로 rewrite한다. Production ingress는 `/api/v1`을 승인된 API upstream으로 직접 전달해야 한다.

## 실행

Root에서 실행한다.

```bash
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test:unit
pnpm test:e2e:web:auth
```

- 개발 URL: `http://localhost:3000`
- Production 실행: `pnpm --filter web start` (`build` 선행)
- Production 환경은 HTTPS `SITE_URL`이 없으면 기동을 거절한다.
- 인증 E2E는 격리된 PostgreSQL, one-off admin, Nest와 Next를 함께 기동하므로 Root에서 실행한다.

## 인증 화면

- `/login`, `/register`
- `/verify-email`, `/password/forgot`, `/password/reset`
- `/auth/refresh`
- `/settings/security`

Verification과 password reset 메일은 token을 query가 아닌 `#token=<percent-encoded-token>` fragment로 전달해야 한다. 화면은 exact 단일 fragment만 읽고 즉시 URL에서 제거한다. Server, ingress, analytics와 referrer에는 action token을 전달하지 않는다.

## 경계

- 재사용 token, Primitive, form, navigation, feedback, overlay, data display, layout과 composite pattern은 `packages/ui`가 소유한다.
- Responsive page composition과 Domain별 정보·action 우선순위는 앱이 소유한다.
- DOM, resize, focus 등 공용 browser hook은 승인된 `@cornerstone/ui/browser` subpath에서만 소비한다.
- HTTP 세부사항은 `packages/api-client`로 모은다.
- 프로젝트 Domain과 화면 조합은 앱이 소유한다.
- 사용자별 Query/Auth 상태를 서버 요청 간 공유하지 않는다.
- Server Component는 정확히 하나인 access Cookie만 `/auth/me`에 전달하고 refresh Cookie가 있을 때 Browser refresh 화면으로 이동한다.
- Password와 action token은 Query cache, persistent storage, trace, screenshot과 URL query에 저장하지 않는다.

## 문서

- [프로젝트 안내](../../README.md)
- [아키텍처와 디자인 시스템 계약](../../docs/cornerstone_assembly_diagram.md)
- [구현 계획](../../docs/cornerstone_implementation_plan.md)
- [ATLAS Industrial + Signal Violet 레퍼런스](../../docs/atlas-industrial-violet.html)
