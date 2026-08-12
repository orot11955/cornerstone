# ADR-0002: Package Boundary와 배포 형식

- 상태: Accepted
- 결정일: 2026-08-12

## 결정

- 공개 `@cornerstone/*` package는 ESM JavaScript와 declaration을 `dist`에 생성하며 source TypeScript를 export하지 않는다.
- `exports` map만 공개 계약으로 사용하고 package 내부 deep import를 지원하지 않는다.
- Root entry는 Node와 SSR에서 import 가능한 pure entry다. DOM 접근이 필요한 코드는 명시적인 `./browser` subpath로만 공개한다.
- UI CSS는 `@cornerstone/ui/styles.css`의 명시적 side-effect entry로 제공한다. React/ReactDOM은 bundle하지 않고 peer dependency로 둔다.
- package는 앱에 의존할 수 없다. 의존 방향은 `types → schemas/utils/config → api-client/ui → apps`이며 실제 의존이 필요할 때만 선언한다.
- package build, typecheck와 test는 Root Turbo 계약에 참여한다. publish 대상은 `files` allowlist로 제한한다.
- 지원 runtime은 ADR-0001의 consumer 범위를 따르며 v1 package는 ESM-only로 배포한다.

## 검증

- export/dependency boundary 검사
- tarball contents 검사
- workspace link가 없는 임시 소비자에서 install, typecheck와 runtime import
- Root/Browser entry의 Node SSR import와 UI CSS export 확인

## 결과

CommonJS 전용 소비자는 지원 대상이 아니다. 새 browser API는 root에 추가하지 않고 `./browser`에 추가해야 한다.
