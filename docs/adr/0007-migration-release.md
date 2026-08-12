# ADR-0007: PostgreSQL Migration과 Release

- 상태: Accepted
- 결정일: 2026-08-13

## Source of Truth

- PostgreSQL schema는 `apps/api/src/database/migrations`의 versioned TypeORM Migration만 변경한다. Entity metadata, `synchronize`, application startup DDL과 수동 운영 SQL을 schema 원천으로 사용하지 않는다.
- runtime과 CLI는 `apps/api/src/database/data-source.ts`의 같은 option builder와 environment schema를 사용한다. 모든 환경에서 `synchronize=false`, `migrationsRun=false`다.
- Migration 파일은 TypeORM이 요구하는 13자리 UTC epoch milliseconds와 의도를 포함한 `<timestamp>-<PascalName>.ts`, Seed는 `apps/api/src/database/seeds`에 둔다. 생성 파일을 적용 전에 review하며 이미 release된 Migration을 수정하지 않는다.
- 각 Migration은 같은 basename의 `.metadata.json`을 가져야 하며 schema가 단계, 호환 release, lock/시간/abort, rollback과 검증을 machine-readable하게 고정한다.

## 단계와 호환성

- `expand`: N과 N-1 application이 함께 read/write할 수 있는 additive change다. nullable column/table/index를 추가하고 dual-read/write 준비를 포함한다.
- `backfill`: expand 뒤 데이터를 변환한다. bounded batch, checkpoint, idempotency와 중단/재시작을 제공하며 deploy transaction 안에서 장시간 실행하지 않는다.
- `contract`: 이전 column/table/constraint 경로를 제거한다. N-1 traffic과 worker가 0이고 rollback window 종료·backup/restore 검증·별도 승인이 끝난 release에서만 실행한다.
- application과 schema의 지원 matrix를 release manifest에 기록한다. expand 전 새 app, contract 뒤 구 app처럼 호환되지 않는 조합은 readiness와 deploy Gate가 거절한다.
- rename/type change는 add → dual write/backfill/read switch → contract 순서로 수행한다. 대형 `NOT NULL`, unique와 foreign key는 가능한 경우 not-valid/검증 단계를 분리해 lock을 제한한다.

## 실행과 권한

- local/CI/Production은 Root `migration:show/run/revert`를 동일 진입점으로 사용한다. `migration:revert`는 ephemeral local/test DB에서만 허용하고 Production URL에서는 fail closed한다.
- Production Migration은 runtime server와 분리된 one-off image/entrypoint와 단기 principal로 실행한다. runtime principal은 DML 최소 권한만 가지며 DDL/role 생성 권한을 갖지 않는다.
- PostgreSQL advisory lock으로 동시에 하나의 Cornerstone Migration runner만 실행한다. lock 대기, statement와 lock timeout은 환경값으로 제한하고 timeout을 무제한 허용하지 않는다.
- application 시작은 pending Migration을 자동 적용하지 않는다. schema compatibility/readiness를 확인하고 맞지 않으면 traffic을 받지 않는다.
- Seed는 개발/test에서만 멱등 실행한다. Production admin bootstrap은 Seed가 아니며 ADR-0010의 별도 protected one-time job을 사용한다.

## Transaction과 side effect

- 기본 TypeORM migration transaction mode는 `each`다. 한 Migration이 transaction을 끄거나 concurrent index를 사용하면 metadata에 이유, 재시작과 실패 후 검증 절차를 기록한다.
- DB mutation과 Mail/Queue 등 외부 side effect 사이에는 transactional outbox를 사용한다. Domain transaction이 outbox row까지 commit하고 별도 worker가 at-least-once 전달한다.
- outbox event는 UUID, type/version, aggregate ID, allowlisted payload, attempt, available/locked/processed 시각과 last error code를 가진다. secret, raw token/password와 불필요한 개인정보를 payload에 넣지 않는다.
- worker는 lease 만료 뒤 재처리 가능하고 provider idempotency key를 사용한다. poison event는 bounded retry 뒤 격리하며 무한 hot loop를 만들지 않는다.

## Metadata

각 `.metadata.json`은 최소 다음 값을 가진다.

```json
{
  "schemaVersion": 1,
  "migrationTimestamp": 1786579260000,
  "phase": "expand",
  "compatibleAppReleases": ["0.1.x"],
  "transaction": "each",
  "estimatedDurationSeconds": 5,
  "lockRisk": "low",
  "statementTimeoutMs": 30000,
  "abortConditions": ["lock_wait_ms > 5000"],
  "backfill": null,
  "rollback": "revert-local-roll-forward-production",
  "verification": ["schema-diff", "forward-revert-forward"]
}
```

- filename과 같은 `migrationTimestamp`, `phase`, duration, risk, timeout, abort, N/N-1 compatibility, backfill checkpoint와 verification 누락을 CI가 거절한다.
- destructive SQL, non-concurrent large index, table rewrite 또는 unbounded update는 risk를 `high`로 분류하고 explicit Operations approval 없이는 candidate를 만들지 않는다.
- metadata는 실행 SQL을 대신하지 않으며 실제 catalog/row count와 dry-run 결과로 추정치를 갱신한다.

## 환경과 test isolation

- `infra/compose/compose.dev.yml`과 `compose.test.yml`은 서로 다른 database, credential, port와 volume/project name을 사용한다. test command가 development/Production DB 이름·host를 받으면 거절한다.
- integration worker는 worker별 schema 또는 database를 사용하고 test 종료 시 자신의 namespace만 제거한다. 공유 DB 전체 truncate와 무작위 다른 worker cleanup을 금지한다.
- CI는 빈 DB `forward → revert → forward`, 직전 release fixture upgrade, schema drift와 pending Migration을 검증한다.
- 첫 schema release만 versioned `0.0.0` empty fixture와 `applicationArtifact: null`을 허용하며 N/N-1 검증을 통과한 것으로 가장하지 않는다. 두 번째 schema release부터는 직전 immutable application artifact와 schema/data fixture가 필수다.
- Entity metadata와 Migration 적용 catalog의 diff가 있거나 application boot 전후 예상하지 않은 DDL이 있으면 실패한다.
- SQL/log/trace에는 parameter value와 connection credential을 남기지 않는다. query name, duration, row count와 error code만 bounded label로 기록한다.

## 배포와 rollback

1. 암호화 backup과 restore 가능성을 확인하고 expand Migration을 one-off principal로 실행한다.
2. N-1과 N application artifact가 expand schema에서 read/write 가능한지 검증한다.
3. 새 application 동일 digest를 candidate에 배포하고 readiness 뒤 traffic을 점진 전환한다.
4. backfill을 별도 resumable job으로 실행하고 checkpoint/lag/error를 관측한다.
5. rollback window 동안 application rollback은 N-1 artifact로 수행하되 DB는 expand 상태를 유지한다.
6. N-1 제거와 backup 검증 뒤 별도 승인 release에서 contract Migration을 실행한다.

- Production 장애에서 `down`으로 data-loss 가능 DDL을 되돌리지 않는다. 기본 복구는 traffic 중단/이전 app + compatible expand schema 또는 corrective forward Migration이다.
- restore가 필요한 경우 새 격리 DB에 복원·검증하고 ADR-0010의 revoke/delete/권한 journal과 global auth epoch/key transition을 적용한 뒤 traffic을 전환한다.
- Migration 실패는 부분 적용 catalog, lock, row count와 checkpoint를 확인하고 metadata의 abort/roll-forward 절차를 따른다. 수동 성공 표시는 금지한다.

## 검증

- 빈 DB와 직전 release fixture에서 forward/revert/forward, upgrade와 schema diff를 자동 검증한다.
- expand schema에 대해 N/N-1 app read/write, backfill 중단·재시작·중복 실행과 contract 전 rollback을 검증한다.
- advisory lock 경쟁, timeout, Production revert/Seed 거절과 runtime principal DDL 거절을 negative test한다.
- outbox commit/rollback, duplicate delivery, lease 만료, worker crash/restart와 poison event 격리를 검증한다.
- backup/restore rehearsal은 checksum, RPO/RTO, restore 뒤 auth revoke/delete journal과 개인정보 비부활까지 확인한다.
- M3 local/CI logical rehearsal은 `pg_dump` custom archive를 새 격리 DB에 restore하고 schema/data fingerprint를 비교한다. provider 암호화, 원격 보존, RPO/RTO와 restore 승인 훈련은 M9가 소유한다.
