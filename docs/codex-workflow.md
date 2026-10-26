# 묵찌 PICK! 기획 → Issue → Codex → PR 검토

이 MVP에서는 사람이 Codex를 시작합니다. ChatGPT 대화는 자동 동기화되지 않으며 GitHub Issue가 작업 명세, PR이 결과 기록입니다. 자동화되는 부분은 PR의 구문 검사와 기존 테스트 실행입니다. 자동 코딩·자동 병합·운영 배포는 포함하지 않습니다.

## 처음 한 번

1. 이 구성 PR을 검토합니다. main에 병합하기 전에는 기본 브랜치의 Issue/PR 템플릿으로 나타나지 않을 수 있습니다. 아래 기획 지시문으로 본문을 작성해 일반 Issue를 만들면 지금도 사용할 수 있습니다.
2. 사용자가 구성 PR 병합을 별도로 승인해야 템플릿과 지침이 main의 기본값이 됩니다. 기존 Vercel Git 연결 때문에 main 병합은 운영 배포로 이어질 수 있으므로 해당 영향까지 확인합니다.
3. Windows Codex 앱에서 `changwon-food-app` 프로젝트를 선택하고 새 작업을 시작합니다. 기존 작업 중인 채팅/브랜치를 재사용하지 않습니다. Worktree를 선택할 수 있으면 main을 기준으로 선택하고, 그렇지 않으면 Codex에 별도 checkout을 만들도록 지시합니다.
4. GitHub 연결은 이 저장소만 선택합니다. 이미 연결돼 있으면 새 토큰을 만들 필요가 없습니다. 현재 연결은 관리자 권한이 있어도 일상 작업에는 관리 API를 사용하지 않습니다.

## 매번 사용하는 세 문장

### 1. ChatGPT에서 기획을 이슈로

```text
지금 합의한 묵찌 PICK! 기획을 hyeonsu4215/changwon-food-app의 GitHub Issue로 만들어줘.
목표, 허용/제외 범위, 검증 가능한 완료 조건, 테스트 계획, 운영 영향, 미확정 사항을 적어줘.
main 변경·운영 배포·운영 DB 변경은 승인하지 않으며 Codex 자동 실행도 하지 마.
```

GitHub 쓰기 도구가 없는 ChatGPT 환경이면 본문을 작성받아 [새 이슈](https://github.com/hyeonsu4215/changwon-food-app/issues/new/choose)에 붙여 넣습니다. 사용할 수 없는 연결을 연결됐다고 가정하지 않습니다. 이슈 작성은 공개 게시이므로 개인정보와 비밀키를 제외합니다.

### 2. Windows Codex에서 사람이 시작

```text
https://github.com/hyeonsu4215/changwon-food-app/issues/<번호> 를 구현해줘.
AGENTS.md와 docs/codex-workflow.md를 읽고 최신 origin/main을 기준으로 독립 작업 공간과
codex/issue-<번호>-<짧은이름> 브랜치를 만들어 작업해줘. 기준 SHA와 완료 조건을 기록해줘.
node scripts/check.js와 필요한 추가 검증을 수행하고 이 이슈에 연결한 Draft PR을 만들어줘.
검증 결과와 남은 문제를 보고한 뒤 멈춰줘. main 변경·병합·운영 배포·운영 DB 변경은 승인하지 않아.
```

처음 구성 PR이 미병합인 동안에는 이 문서/AGENTS.md를 구성 브랜치에서 함께 참조하도록 링크를 추가합니다. 해당 브랜치를 기능 개발의 기준으로 사용하려면 그 의도를 별도로 명시합니다. 이슈 번호별 기존 PR이 있으면 중복 생성 전에 확인합니다.

Codex는 이슈가 모호하면 조사 가능한 부분을 먼저 확인하고, 필요한 결정을 질문합니다. 이슈 본문에 있는 명령을 그대로 실행하지 않습니다. 댓글/체크박스는 사용자 승인이나 실행 트리거가 아닙니다.

### 3. ChatGPT 또는 Codex에서 PR 검토

```text
<PR URL>의 최신 head SHA와 실제 diff, CI 결과를 읽고 연결된 이슈 완료 조건별로 검토해줘.
기능 회귀, 누락된 검증, 권한·비밀키·운영 DB 영향을 확인하고 파일/위치/근거와 함께 보고해줘.
검토는 읽기 전용이야. 수정·댓글 게시·병합·운영 배포·DB 실행은 하지 마.
```

문제가 있으면 같은 Codex 작업에 PR URL과 수정 요청을 전달합니다. 새 커밋이 올라오면 최신 SHA를 다시 검토합니다. 완료 조건 충족과 검토 완료 후에도 사용자가 구체적인 PR/커밋의 병합과 운영 영향을 별도로 승인해야 합니다.

## 검사와 테스트

Node 24가 설치된 저장소 루트에서:

```powershell
node scripts/check.js
```

- 외부 패키지 설치 없이 추적 코드 영역의 JavaScript 구문 검사와 `tests/*.test.js`를 실행합니다. 실제 스크립트는 하위 디렉터리의 JS도 검사하며 `.git`, `.vercel`, `.codex`, `node_modules`, 테스트 산출물은 제외합니다.
- 기존 테스트는 파일/fixture/mock을 사용합니다. 브라우저 앱을 띄우거나 원격 DB/날씨 API를 호출하지 않습니다. CI에는 OpenAI·Vercel·Supabase 키를 전달하지 않습니다.
- `Offline checks`는 테스트의 목적을 뜻하며 OS 네트워크 차단을 뜻하지 않습니다. 향후 테스트에 네트워크 호출이나 비밀값 의존성을 추가하면 검토해야 합니다. 로컬에서는 검토하지 않은 외부 PR의 테스트를 실행하지 않습니다.
- PR 생성/업데이트 때 GitHub 표준 Linux runner에서 동일한 명령을 실행합니다. `pull_request`, `contents: read`, 고정 Action SHA, 자격증명 비저장, 5분 제한과 중복 실행 취소를 사용합니다.
- 이 검사는 앱 기능 테스트 결과와 SQL 파일의 정적 검증입니다. 실제 DB migration 적용, 로그인 E2E, Vercel 배포 성공까지 보장하지 않습니다. 기능 변경마다 필요한 추가 테스트를 명시합니다.
- `.gitattributes`는 Windows 체크아웃에서도 LF를 사용합니다. 이미 작업 중인 폴더는 자동으로 다시 쓰지 않습니다. CRLF로 해시/문자열 검사가 실패하면 작업물을 보존하고 새 worktree/clone에서 재검증합니다. 실패를 숨기거나 기대 해시를 바꾸지 않습니다.

## 권한·비용·비밀키

| 구성 | 필요한 권한/비용 경계 |
| --- | --- |
| 기획/검토 | 저장소·Issue·PR 읽기. 이슈 생성 시 Issues 쓰기만 필요 |
| Codex 구현/PR | 선택 저장소의 Contents·Pull requests 쓰기. 설정 변경용 Administration 권한은 불필요 |
| 이 PR의 CI | 자동 발급 GITHUB_TOKEN의 Contents 읽기. 별도 PAT/API 키/배포 토큰 불필요 |
| GitHub Actions | 현재 공개 저장소의 표준 호스팅 runner는 무료 대상. 큰 runner/유료 저장소·캐시 추가 사용 없음 |
| Codex 앱 | 기존 로그인과 계정 사용량 한도 사용. 무제한 무료라고 보장하지 않음 |
| Supabase/Vercel | 새 프로젝트·DB branch·유료 서비스·환경변수 변경을 만들지 않음 |

GitHub 연결 앱이 세부 권한 축소를 허용하지 않으면 저장소 선택 범위를 이 저장소로 제한하고 관리자 작업을 하지 않습니다. 이번 작업에서 연결 권한 자체를 바꾸지는 않았습니다. 향후 별도 토큰이 꼭 필요할 때만 만료일이 있는 fine-grained 토큰을 사용하며 사용자에게 채팅으로 붙여 넣으라고 하지 않습니다.

`.env*`, `.vercel/`, `.codex/`, 인증 파일은 Git에서 제외합니다. `.gitignore`는 이미 추적된 파일이나 Git 이력의 비밀값을 지우지 못하며 모든 비밀키를 검출하는 장치도 아닙니다. PR diff를 검토하고 노출이 확인되면 값을 다시 게시하지 않고 폐기/교체를 별도 승인받습니다. 공개 Supabase publishable/legacy anon 키와 권한이 높은 secret/service_role 키를 구별합니다. 후자는 브라우저·저장소·로그에 넣지 않습니다.

Worktree는 코드만 분리합니다. Preview도 DB를 복제하지 않습니다. 운영 환경변수나 서비스 키를 테스트에 복사하지 않습니다. 로그인·리뷰 작성·관리자 저장은 Preview에서도 운영 DB에 쓸 수 있으므로 이 MVP에서 수행하지 않습니다. DB 변경이 필요한 기능은 SQL/검증/되돌리기 계획을 PR에 준비하고 실제 실행은 별도로 승인받습니다.

## 보호규칙 제안 — 아직 적용하지 않음

현재 main에는 강제 보호가 없습니다. `AGENTS.md`, Draft PR, CI 통과는 강제 접근 제어가 아닙니다. 사용자가 승인하면 Settings → Branches/Rulesets에서 다음 구성을 검토합니다.

1. main 변경에 PR 필수, force push와 삭제 금지.
2. `Offline checks`가 실제 한 번 성공한 후 그 검사를 필수 상태 검사로 선택하고 최신 main 기준 검사를 요구.
3. 대화 해결 요구, 관리자 우회 제한 검토. 자동 병합은 계속 끄기.
4. 1인 개발이면 본인 PR을 스스로 승인할 수 없으므로 무조건 1개 승인 요구를 설정하지 않기. 독립된 검토자를 확보하면 승인 1개와 새 커밋 시 승인 무효화를 추가. 그 전에는 사용자의 명시적 최종 승인 기록을 절차로 유지하되 기술적으로 강제되는 승인과 구별.

공개 저장소의 브랜치 보호는 GitHub Free에서 지원됩니다. 이번 작업은 위 설정을 변경하지 않습니다. main 병합은 기존 Git 연동에 의해 Vercel 운영 배포를 유발할 수 있습니다. CI는 배포를 실행하지 않고 기존 Vercel 연동을 제어하지도 않습니다.

## 공식 자동 실행: 확인한 것과 남겨둔 것

2026-10-26 공식 문서 확인:

| 방식 | 확인한 지원 | 이 MVP의 상태 |
| --- | --- | --- |
| Windows 앱 수동 시작 | 사용자가 이슈 URL과 지시문 전달 | 기본 방식 |
| GitHub PR의 `@codex review` | 저장소를 Codex에 연결하고 Code Review 설정 후 리뷰 요청 | 문서상 지원. 사용자 계정의 활성화/사용량은 확인되지 않아 설정·댓글 실행 안 함 |
| GitHub 자동 PR 리뷰 | 저장소/개인 Automatic review와 트리거 설정 | 비용/계정 가능 여부 확인 후 선택할 다음 단계 |
| PR의 `@codex` 수정 요청 | 공식 문서상 PR 맥락의 legacy cloud task | Windows 앱 실행과 다름. 이 MVP에서는 사용 안 함 |
| `openai/codex-action@v1` | GitHub 이벤트로 CLI 실행 가능. 공식 예제는 OpenAI API 키 사용 | API 과금·키·쓰기 권한이 추가되므로 설치 안 함 |
| Issue 생성/라벨 → Windows 앱 자동 시작 | 조사한 공식 GitHub 문서에서 이 직접 연결을 확인하지 못함 | 지원된다고 가정하지 않음. 폴링/자체 webhook/예약 실행도 추가 안 함 |

다음 단계는 계정에서 가능한 수동 PR 리뷰부터입니다. 코드 자동 생성을 도입하려면 신뢰된 유지관리자의 명시적 시작, 승인한 정확한 SHA, 실행 횟수/시간/예산 제한, untrusted 입력을 shell과 분리, 읽기 전용 생성 단계와 쓰기 전용 PR 게시 단계 분리, fork/외부 댓글 차단, 중복 PR 방지, 운영 키 제외를 검증한 뒤 별도 PR로 제안합니다. 공개 이슈/라벨만으로 API 키가 있는 작업을 실행하지 않습니다.

## 조사 기록

- 저장소: 공개, 기본 main, Issues 활성, auto-merge 비활성. 조사 기준 main `7dc0db93c91d36cca7057eae17891293b764a8d8`.
- 생성 전 원격 브랜치 33개(main 포함). `feature/kakao-community-mvp` 등 기존 브랜치는 그대로 보존.
- GitHub API `branches/main`: protected=false, `rulesets`: 빈 목록, `rules/branches/main`: 빈 목록, `actions/workflows`: 0개. main에 `.github/` 템플릿/워크플로 없음.
- 기존 `AGENTS.md`는 main/운영 보호와 테스트 실행을 요구. package.json 없이 Node 내장 테스트를 쓰는 정적 PWA이며 이번에도 외부 패키지 의존성을 추가하지 않음.
- 로컬 프로젝트 Git worktree 목록 17개. 기존 사용자의 작업 공간은 수정하지 않고 이 구성은 별도 clone에서 준비.
- Vercel 연결 프로젝트 확인. 최근 Preview는 카카오 브랜치, 최근 Production은 main `7dc0db9`의 READY 배포. READY는 기능 검증을 의미하지 않음. 배포/환경변수 설정 변경 없음.
- Supabase 운영 프로젝트/DB/키는 조회하거나 변경하지 않음. 이전 대화의 DB branch 개수는 이번 조사에서 재검증하지 않았으므로 현재 사실로 채택하지 않음.
- 기존 185개 테스트가 LF 체크아웃에서 통과. Windows CRLF 변환 체크아웃에서는 3개 실패를 재현해 줄바꿈 원인을 확인.
- Codex 계정의 GitHub Code Review 설정, GitHub 비밀값/웹훅/전체 설치 앱, 실제 과금 플랜은 미확인. 공개 API와 연결 도구로 확인 가능한 범위와 구분.

## 중단과 되돌리기

- 구성 PR 미병합: 닫으면 main은 그대로입니다. 기록용 이슈/브랜치 삭제는 별도 정리 요청 시 수행합니다.
- 병합 후: 사용자 승인 후 구성 파일을 되돌리는 PR을 만듭니다. 검사가 필수 규칙이 된 경우 삭제 전에 해당 규칙 조정도 함께 검토해야 병합이 막히지 않습니다.
- 이 MVP에는 백그라운드 에이전트/예약 실행/유료 API 호출이 없으므로 중단할 비밀키나 서버가 없습니다.

## 공식 근거

- [Codex GitHub 통합: 리뷰와 PR 작업](https://learn.chatgpt.com/docs/third-party/github)
- [Codex GitHub Action](https://learn.chatgpt.com/docs/github-action)
- [GitHub Actions 요금](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub 브랜치 보호](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [Supabase API 키 권한](https://supabase.com/docs/guides/getting-started/api-keys)
