# Local PostgreSQL

이 디렉터리는 개발 DB와 자동화 test DB를 서로 다른 Compose project, port, database, credential과 storage로 격리한다. 포함된 password는 localhost 전용 공개 fixture이며 운영 환경에서 재사용하지 않는다.

## 개발 DB

```bash
pnpm db:dev:up
cp apps/api/.env.example apps/api/.env
pnpm migration:run
pnpm seed
pnpm database:verify
pnpm db:dev:down
```

개발 데이터는 named volume에 유지된다. 데이터 삭제가 필요한 volume 제거는 명시적으로 수행하며 일반 `db:dev:down`은 volume을 지우지 않는다.

## Test DB

```bash
pnpm db:test:up
NODE_ENV=test \
DATABASE_URL=postgresql://cornerstone_test_app:cornerstone-test-app@localhost:55432/cornerstone_test \
DATABASE_MIGRATION_URL=postgresql://cornerstone_test_migrator:cornerstone-test-migrator@localhost:55432/cornerstone_test \
pnpm migration:run
NODE_ENV=test \
DATABASE_URL=postgresql://cornerstone_test_app:cornerstone-test-app@localhost:55432/cornerstone_test \
DATABASE_MIGRATION_URL=postgresql://cornerstone_test_migrator:cornerstone-test-migrator@localhost:55432/cornerstone_test \
pnpm database:verify
pnpm db:test:down
```

Test 데이터는 tmpfs에만 저장된다. `cornerstone_test_app`은 schema DDL 권한을 받지 않으며 각 Migration이 업무 table별 DML 권한을 명시해야 한다. Migration 이력과 schema는 `cornerstone_test_migrator`만 변경한다.

`pnpm seed`는 개발/test에서만 비밀 없는 pending reference User와 Audit event를 멱등 생성한다. 로그인 가능한 공용 password와 admin은 만들지 않으며 production에서는 DB 연결 전에 거절한다.

Root `pnpm test:integration`은 이 test Compose project를 내린 뒤 새로 기동하므로 `cornerstone_test`의 기존 test 데이터는 보존하지 않는다. Migration `forward → revert → forward`, schema/권한/advisory lock 검증을 수행하고 성공·실패와 관계없이 container와 network를 정리한다.

## 운영 경계

- Compose fixture는 운영 배포용이 아니다.
- 운영은 `DATABASE_SSL_MODE=verify-full`과 서로 다른 runtime/migration principal을 요구한다.
- runtime과 migration URL은 동일 host/port/database를 가리켜야 한다.
- 운영 DB provisioning은 Migration 전에 `cornerstone_runtime` NOLOGIN group role을 만들고 runtime principal에 membership만 부여해야 한다.
- `migration:revert`는 production에서 fail closed한다. 운영 복구는 ADR-0007의 roll-forward 절차를 따른다.
