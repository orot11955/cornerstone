# create-cornerstone

Cornerstone capability manifest를 검증하고 재현 가능한 프로젝트를 생성하는 CLI다.

```bash
pnpm exec create-cornerstone plan --manifest cornerstone.config.yml
pnpm exec create-cornerstone create ./my-app --manifest cornerstone.config.yml
pnpm exec create-cornerstone verify ./my-app
```

`0.1.0`에서 생성이 인증된 범위는 추가 capability가 없는 `minimal` Profile이다. 다른 Profile은 필요한 fragment와 통합 Gate가 구현되기 전까지 fail-closed로 거절한다.

`cornerstone.config.yml`과 `.cornerstone/manifest.lock.json`에는 secret이나 credential 값을 넣지 않는다. 생성 프로젝트는 두 파일을 모두 version control에 포함한다.
