# Cornerstone API

Cornerstone의 NestJS Backend 앱이다. API 계약, 입력 검증, 인증·권한, 데이터 접근과 서버 관측 경계를 담당한다.

현재 API/관측 경계, PostgreSQL Migration·runtime 연결, password-session 인증과 기본 사용자 관리 경계를 제공한다. 이후 범위는 [구현 계획](../../docs/cornerstone_implementation_plan.md)에 따라 추가한다.

## 환경 변수

```bash
cp apps/api/.env.example apps/api/.env
```

필수 키와 예시는 `apps/api/.env.example`을 기준으로 한다. 실제 password와 token secret은 커밋하거나 로그에 남기지 않는다.

## One-off initial administrator bootstrap

`pnpm admin:bootstrap`은 런타임 HTTP와 분리된 단발성 작업이다. `ADMIN_BOOTSTRAP_EMAIL`, 전용 `DATABASE_ADMIN_BOOTSTRAP_URL`, 필수 비밀 없는 승인 상관 ID `ADMIN_BOOTSTRAP_REQUEST_ID`를 사용하며 password는 development/test에서 newline 없는 stdin, production에서 권한 `0600` 이하의 regular secret file(`ADMIN_BOOTSTRAP_PASSWORD_FILE`)로만 받는다. password를 argv나 로그에 전달하지 않는다. 일반 API runtime 환경은 이 bootstrap 전용 변수를 거절한다.

`admin_bootstrap_markers`는 singleton marker와 생성된 admin user ID만 저장하는 immutable bootstrap contract다. marker가 있거나 활성 admin이 하나라도 있으면 bootstrap은 거절된다. runtime principal에는 이 테이블의 모든 권한을 부여하지 않는다.

`pnpm database:verify`는 bootstrap 함수와 전용 principal ACL까지 포함한 full gate이므로 `DATABASE_ADMIN_BOOTSTRAP_URL`이 없으면 fail closed한다. 장기 runtime에는 이 값을 주입하지 않고 검증 job에만 전달한다.

## 실행과 검증

Root에서 실행한다.

```bash
pnpm --filter api dev
pnpm --filter api build
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api test
pnpm test:integration
pnpm test:e2e
```

- 기본 URL: `http://localhost:4000`
- Production 실행: `pnpm --filter api start:prod` (`build` 선행)
- DB 시작·Migration·Seed와 권한 검증은 [`infra/compose/README.md`](../../infra/compose/README.md)를 따른다.

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
