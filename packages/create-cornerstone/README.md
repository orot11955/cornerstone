# create-cornerstone

Cornerstone capability manifest를 검증하고 재현 가능한 프로젝트를 생성하는 CLI다.

```bash
pnpm exec create-cornerstone plan --manifest cornerstone.config.yml
pnpm exec create-cornerstone plan ./my-app --dry-run
pnpm exec create-cornerstone create ./my-app --manifest cornerstone.config.yml
pnpm exec create-cornerstone update ./my-app --dry-run
pnpm exec create-cornerstone update ./my-app
pnpm exec create-cornerstone verify ./my-app
```

`--manifest`를 생략하면 프로젝트명, Profile과 제품 license를 대화형으로 선택한다. 대화형 입력과 manifest 입력은 동일한 resolver와 생성 plan을 사용한다.

`minimal`은 기존 lock v1과 생성 결과를 유지한다. `standard`는 `web`, `api`, `ui`, `database`, `auth`의 exact 조합을 lock v2로 생성할 수 있지만 `standard-preview-node24-pg17`의 Supported Composition일 뿐 Certified Profile은 아니다. 운영 인증 Gate가 완료되기 전까지 `production`과 `regulated`는 fail-closed로 거절한다.

Standard 생성 결과는 workspace에서 git-tracked source만 allowlist로 snapshot한 canonical fragment와 versioned structured composer로 만든다. Composer가 소유하는 공유 파일은 임의 text patch나 hook을 실행하지 않으며, 충돌하는 JSON/YAML key는 생성 전에 거절한다. `NOTICE`는 항상 생성하고 `LICENSE`는 manifest가 `ISC` 또는 `MIT`를 선택한 경우에만 생성한다.

기존 Standard v2 프로젝트는 먼저 `plan <target> --dry-run`으로 결정적 change set과 예상 line diff를 확인한 뒤 `update <target>`으로 갱신한다. Update는 composer 소유 공유 파일과 lock만 변경하고 fragment의 사용자 소유 source는 덮어쓰지 않는다. Manifest/resolution 또는 fragment 계약이 달라졌거나 공유 파일이 lock 이후 수정되었다면 manual migration으로 fail-closed한다. 적용 전 모든 touched 파일과 lock을 `.cornerstone` 아래 journal/backup에 보존하고 lock을 마지막에 교체한다. 중단된 journal이 있으면 read-only `plan`은 복구 필요 오류로 중단하고, 다음 실제 `update`가 pending 작업을 rollback하거나 committed 작업의 잔여 backup을 정리한 뒤 다시 계획한다.

실제 update는 `.cornerstone/update.lock`을 독점 획득하며 read-only dry-run은 operation lock을 만들지 않는다. Process crash로 stale lock이 남아도 generator가 자동 삭제하지 않는다. 기록된 PID의 process가 종료되었고 다른 update가 실행 중이지 않음을 운영자가 확인한 뒤에만 `update.lock` 디렉터리를 수동 제거하고 recovery를 다시 실행한다.

Updater를 `sudo`나 다른 elevated privilege로 실행하지 않는다. POSIX의 실제 update는 target, `.cornerstone`, generator가 쓰는 output·metadata·backup의 parent directory가 effective user 소유이고 group/world writable이 아닌 단독 쓰기 경계일 때만 허용한다. Target 상위 chain도 교체 불가능해야 하며, 표준 temporary directory처럼 sticky bit가 설정된 공유 parent에서는 effective user 소유 child만 허용한다. 사용자 소유 fragment directory 전체에는 이 write-boundary 정책을 적용하지 않는다. Operation lock은 이 경계를 따르는 협조적인 updater끼리만 직렬화한다. 외부 editor나 같은 user의 다른 process가 검사와 rename 사이에 파일을 바꾸는 경쟁은 지원하지 않으며, rename 직전 checksum/mode 재검사는 best-effort drift detection일 뿐 원자적인 동시 수정 방지 보장이 아니다. Symlink와 realpath 검사는 이 소유권·권한 신뢰 경계 안에서 적용된다.

`cornerstone.config.yml`과 `.cornerstone/manifest.lock.json`에는 secret이나 credential 값을 넣지 않는다. 생성 프로젝트는 두 파일을 모두 version control에 포함한다.

`verify`는 user manifest와 resolution, bundled fragment/composer metadata, composer가 소유하는 공유 output의 일관성과 drift를 검증한다. 사용자 소유 fragment source를 원본 Template과 byte-identical하게 강제하거나 생성 프로젝트 전체의 tamper 인증을 제공하지 않는다. Lock의 `integrity`도 lock 내부 필드의 self-consistency digest이며 release authenticity 증명이 아니다. Generator package와 Template의 authenticity는 package provenance 및 M9 distribution-trust Gate에서 검증한다.

공개 JSON Schema는 required field, type, enum, `additionalProperties`, 정확히 같은 array item의 `uniqueItems` 같은 구조 검증에 사용한다. JSON Schema만으로 dependency cycle, ID 기준 중복, output path의 case-fold/NFC 충돌, output owner 참조와 certification/resolved profile 일치 같은 semantic 규칙을 모두 표현할 수는 없다. 따라서 JSON Schema 검증 뒤 공개 `parseCapabilityCatalog`와 `projectLockSchema` Zod parser를 authoritative semantic 검증 단계로 반드시 실행한다.
