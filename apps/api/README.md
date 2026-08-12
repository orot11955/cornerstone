# Cornerstone API

Cornerstone의 NestJS Backend 앱이다. API 계약, 입력 검증, 인증·권한, 데이터 접근과 서버 관측 경계를 담당한다.

현재는 기본 scaffold와 환경 변수 검증을 구성하는 단계다. Database, Auth와 운영 기반은 [구현 계획](../../docs/cornerstone_implementation_plan.md)에 따라 추가한다.

## 환경 변수

```bash
cp apps/api/.env.example apps/api/.env
```

필수 키와 예시는 `apps/api/.env.example`을 기준으로 한다. 실제 password와 token secret은 커밋하거나 로그에 남기지 않는다.

## 실행과 검증

Root에서 실행한다.

```bash
pnpm --filter api dev
pnpm --filter api build
pnpm --filter api typecheck
pnpm --filter api test
pnpm --filter api test:e2e
```

- 기본 URL: `http://localhost:4000`
- Production 실행: `pnpm --filter api start:prod` (`build` 선행)
- 현재 `lint` script는 파일을 수정하는 `--fix` 방식이다. CI용 비수정 lint가 분리되기 전에는 실행 시 작업 트리 변경에 주의한다.

## 경계

- `Controller → Service → Repository` 책임을 유지한다.
- Entity를 API 응답으로 직접 노출하지 않는다.
- 환경 변수는 startup에서 검증하고 ConfigService를 통해 접근한다.
- Migration은 앱 시작과 분리하며 `synchronize`로 대체하지 않는다.
- 인증과 권한은 Frontend 상태와 무관하게 API에서 검증한다.

## 문서

- [프로젝트 안내](../../README.md)
- [아키텍처와 설계 원칙](../../docs/cornerstone_assembly_diagram.md)
- [구현 계획](../../docs/cornerstone_implementation_plan.md)
