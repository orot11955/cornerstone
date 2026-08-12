# Branch Protection 기준

GitHub `main` branch는 다음 설정을 적용한다. Repository 관리자만 설정할 수 있으므로 workflow와 별도로 실제 GitHub 설정을 확인한다.

- Pull request 없이 merge 금지
- 승인 1명 이상, 새 commit에서 이전 승인 해제
- CODEOWNER review 필수
- 대화가 해결되지 않은 PR merge 금지
- force push와 branch deletion 금지
- 관리자 우회 금지. 긴급 break-glass는 사유·승인자·만료 시각을 기록하고 종료 뒤 audit한다.
- required checks: `Quality`, `E2E`, `Security`
- merge queue를 사용하면 위 세 check를 merge-group event에도 실행

`CODEOWNERS`의 `@orot`는 저장소에 write 권한이 있는 실제 GitHub account인지 확인한 뒤 required review를 활성화한다. Organization team으로 전환할 때는 같은 commit에서 모든 경로 owner와 branch protection을 함께 갱신한다.
