# create-cornerstone

Cornerstone capability manifest를 검증하고 재현 가능한 프로젝트를 생성하는 CLI다.

```bash
pnpm exec create-cornerstone plan --manifest cornerstone.config.yml
pnpm exec create-cornerstone create ./my-app --manifest cornerstone.config.yml
pnpm exec create-cornerstone verify ./my-app
```

`--manifest`를 생략하면 프로젝트명, 인증된 Profile과 제품 license를 대화형으로 선택한다. 대화형 입력과 manifest 입력은 동일한 resolver와 생성 plan을 사용한다.

`0.1.0`에서 생성이 인증된 범위는 추가 capability가 없는 `minimal` Profile이다. 다른 Profile은 필요한 fragment와 통합 Gate가 구현되기 전까지 fail-closed로 거절한다.

`cornerstone.config.yml`과 `.cornerstone/manifest.lock.json`에는 secret이나 credential 값을 넣지 않는다. 생성 프로젝트는 두 파일을 모두 version control에 포함한다.

공개 JSON Schema는 required field, type, enum, `additionalProperties`, 정확히 같은 array item의 `uniqueItems` 같은 구조 검증에 사용한다. JSON Schema만으로 dependency cycle, ID 기준 중복, output path의 case-fold/NFC 충돌, output owner 참조와 certification/resolved profile 일치 같은 semantic 규칙을 모두 표현할 수는 없다. 따라서 JSON Schema 검증 뒤 공개 `parseCapabilityCatalog`와 `projectLockSchema` Zod parser를 authoritative semantic 검증 단계로 반드시 실행한다.
