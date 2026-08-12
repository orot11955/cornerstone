# create-cornerstone

Cornerstone capability manifest를 검증하고 재현 가능한 프로젝트를 생성하는 CLI다.

```bash
pnpm exec create-cornerstone plan --manifest cornerstone.config.yml
pnpm exec create-cornerstone create ./my-app --manifest cornerstone.config.yml
pnpm exec create-cornerstone verify ./my-app
```

`--manifest`를 생략하면 프로젝트명, Profile과 제품 license를 대화형으로 선택한다. 대화형 입력과 manifest 입력은 동일한 resolver와 생성 plan을 사용한다.

`minimal`은 기존 lock v1과 생성 결과를 유지한다. `standard`는 `web`, `api`, `ui`, `database`, `auth`의 exact 조합을 lock v2로 생성할 수 있지만 `standard-preview-node24-pg17`의 Supported Composition일 뿐 Certified Profile은 아니다. 운영 인증 Gate가 완료되기 전까지 `production`과 `regulated`는 fail-closed로 거절한다.

Standard 생성 결과는 workspace에서 git-tracked source만 allowlist로 snapshot한 canonical fragment와 versioned structured composer로 만든다. Composer가 소유하는 공유 파일은 임의 text patch나 hook을 실행하지 않으며, 충돌하는 JSON/YAML key는 생성 전에 거절한다. `NOTICE`는 항상 생성하고 `LICENSE`는 manifest가 `ISC` 또는 `MIT`를 선택한 경우에만 생성한다.

`cornerstone.config.yml`과 `.cornerstone/manifest.lock.json`에는 secret이나 credential 값을 넣지 않는다. 생성 프로젝트는 두 파일을 모두 version control에 포함한다.

`verify`는 user manifest와 resolution, bundled fragment/composer metadata, composer가 소유하는 공유 output의 일관성과 drift를 검증한다. 사용자 소유 fragment source를 원본 Template과 byte-identical하게 강제하거나 생성 프로젝트 전체의 tamper 인증을 제공하지 않는다. Lock의 `integrity`도 lock 내부 필드의 self-consistency digest이며 release authenticity 증명이 아니다. Generator package와 Template의 authenticity는 package provenance 및 M9 distribution-trust Gate에서 검증한다.

공개 JSON Schema는 required field, type, enum, `additionalProperties`, 정확히 같은 array item의 `uniqueItems` 같은 구조 검증에 사용한다. JSON Schema만으로 dependency cycle, ID 기준 중복, output path의 case-fold/NFC 충돌, output owner 참조와 certification/resolved profile 일치 같은 semantic 규칙을 모두 표현할 수는 없다. 따라서 JSON Schema 검증 뒤 공개 `parseCapabilityCatalog`와 `projectLockSchema` Zod parser를 authoritative semantic 검증 단계로 반드시 실행한다.
