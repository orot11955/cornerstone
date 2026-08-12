# Local PostgreSQL

이 디렉터리는 개발 DB와 자동화 test DB를 서로 다른 Compose project, port, database, credential과 storage로 격리한다. 포함된 password는 localhost 전용 공개 fixture이며 운영 환경에서 재사용하지 않는다.

## 개발 DB

```bash
pnpm db:dev:up
cp apps/api/.env.example apps/api/.env
pnpm migration:run
pnpm seed
DATABASE_ADMIN_BOOTSTRAP_URL=postgresql://cornerstone_dev_admin_bootstrap:cornerstone-dev-admin-bootstrap@localhost:5432/cornerstone_dev pnpm database:verify
pnpm db:dev:down
```

개발 데이터는 named volume에 유지된다. 데이터 삭제가 필요한 volume 제거는 명시적으로 수행하며 일반 `db:dev:down`은 volume을 지우지 않는다.

## Test DB

```bash
pnpm db:test:up
NODE_ENV=test \
DATABASE_URL=postgresql://cornerstone_test_app:cornerstone-test-app@localhost:55432/cornerstone_test \
DATABASE_MIGRATION_URL=postgresql://cornerstone_test_migrator:cornerstone-test-migrator@localhost:55432/cornerstone_test \
DATABASE_MAINTENANCE_URL=postgresql://cornerstone_test_maintenance:cornerstone-test-maintenance@localhost:55432/cornerstone_test \
pnpm migration:run
NODE_ENV=test \
DATABASE_URL=postgresql://cornerstone_test_app:cornerstone-test-app@localhost:55432/cornerstone_test \
DATABASE_MIGRATION_URL=postgresql://cornerstone_test_migrator:cornerstone-test-migrator@localhost:55432/cornerstone_test \
DATABASE_MAINTENANCE_URL=postgresql://cornerstone_test_maintenance:cornerstone-test-maintenance@localhost:55432/cornerstone_test \
DATABASE_ADMIN_BOOTSTRAP_URL=postgresql://cornerstone_test_admin_bootstrap:cornerstone-test-admin-bootstrap@localhost:55432/cornerstone_test \
pnpm database:verify
pnpm db:test:down
```

Test 데이터는 tmpfs에만 저장된다. `cornerstone_test_app`은 schema DDL 권한을 받지 않으며 각 Migration이 업무 table별 DML 권한을 명시해야 한다. Migration 이력과 schema는 `cornerstone_test_migrator`만 변경한다. `cornerstone_test_maintenance`는 table 직접 DML 권한 없이 Migration이 봉인한 bounded cleanup 함수만 실행하며 User와 Audit 원문을 조회·변경할 수 없다.

`pnpm seed`는 개발/test에서만 비밀 없는 pending reference User와 Audit event를 멱등 생성한다. 로그인 가능한 공용 password와 admin은 만들지 않으며 production에서는 DB 연결 전에 거절한다.

Root `pnpm test:integration`과 `pnpm test:e2e`는 이 test Compose project를 내린 뒤 새로 기동하므로 `cornerstone_test`의 기존 test 데이터는 보존하지 않는다. Migration `forward → revert → forward`, schema/권한/advisory lock 검증과 멱등 Seed를 수행하고 성공·실패와 관계없이 container와 network를 정리한다.

Integration 마지막에는 `pg_dump --format=custom` archive를 메모리에서 생성해 `cornerstone_restore_test`에 복원하고 source/restore fingerprint를 비교한다. 이 임시 restore DB도 항상 삭제하며 provider 암호화 backup과 원격 보존 훈련은 M9 범위다.

## 운영 경계

- Compose fixture는 운영 배포용이 아니다.
- 운영은 `DATABASE_SSL_MODE=verify-full`과 서로 다른 runtime/migration principal을 요구한다.
- 운영 retention job은 runtime/migration과 다른 `DATABASE_MAINTENANCE_URL` principal을 요구한다.
- initial-admin bootstrap은 runtime HTTP/image와 분리된 `pnpm admin:bootstrap` one-off job으로만 수행한다. `DATABASE_ADMIN_BOOTSTRAP_URL` principal은 runtime/migration/maintenance와 달라야 하며 raw table 권한 없이 hardened bootstrap function `EXECUTE`만 받는다.
- production bootstrap은 `ADMIN_BOOTSTRAP_EMAIL`, 비밀 없는 승인 상관 ID `ADMIN_BOOTSTRAP_REQUEST_ID`, regular non-symlink secret file `ADMIN_BOOTSTRAP_PASSWORD_FILE`(mode 0600 이하)을 사용한다. password는 argv/log에 넣지 않는다. 성공·거절·실패와 무관하게 connection 종료, membership revoke, login role `NOLOGIN`/drop, secret lease/version 폐기와 폐기 credential 재연결 실패가 traffic 전 fail-closed gate이며 provider audit/change ID를 증거로 남긴다.
- runtime principal은 `admin_bootstrap_markers`에 권한이 없다. marker 또는 active admin이 있으면 bootstrap은 stable nonzero exit로 거절된다.
- runtime과 migration URL은 동일 host/port/database를 가리켜야 한다.
- 운영 DB provisioning은 Migration 전에 `cornerstone_runtime` NOLOGIN group role을 만들고 runtime principal에 membership만 부여해야 한다.
- `migration:revert`는 production에서 fail closed한다. 운영 복구는 ADR-0007의 roll-forward 절차를 따른다.
- `pnpm retention:cleanup`은 한 table당 실행당 최대 `RETENTION_BATCH_SIZE`(기본 1,000)만 삭제한다. 운영 scheduler가 반복 실행하며 Runtime 서비스에서는 호출하지 않는다.
