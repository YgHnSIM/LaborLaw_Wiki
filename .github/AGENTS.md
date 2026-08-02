# CI·Pages 운영 지침

## 범위

`.github/`는 저장소 검증과 GitHub Pages 배포 설정의 운영 경계다. 기능 구현 규칙은 루트와 `site/AGENTS.md`, 위키 형식은 `wiki/AGENTS.md`에 둔다.

## 검증 workflow

`workflows/lint-wiki.yml`은 push·pull request·수동 실행에서 Python 3.12와 Node 24를 사용하고 `npm ci`, Python 단위 테스트, `sync_wiki.py --check`, `npm test`, strict-warning 린트와 적절한 `--base` 검사를 실행한다. `schema/`, `scripts/schema.py`, `scripts/lint_wiki.py` 등 부트스트랩 파일 변경 시 trusted base-linter 예외가 적용될 수 있으므로 현재 린트만으로 무결성을 판단하지 않는다.

검증 job은 `contents: read` 최소 권한을 유지하고, 동일 ref의 오래된 실행을 취소하는 concurrency 정책을 보존한다. workflow 명령·Python/Node 버전·action 버전을 바꾸면 README와 루트 검사 계약도 함께 확인한다.

## Pages workflow

`workflows/pages.yml`은 `main` push 또는 수동 실행에서만 배포한다. build job은 전체 검증과 `npm run build`를 수행하고, deploy job만 `pages: write`·`id-token: write`와 `github-pages` 환경을 사용한다. `configure-pages`가 제공하는 `base_path`·`base_url`과 현재 커밋 SHA를 빌드에 전달하는 계약을 유지한다.

GitHub Pages의 Source는 GitHub Actions여야 하며, repository ruleset의 Code Owner 승인과 `Lint wiki / lint` required check를 우회하지 않는다. `.github/CODEOWNERS`에 지정된 `@YgHnSIM` 보호 경로를 확인한다.

## 보안·변경 금지

토큰·비밀·개인정보를 workflow·로그·출력에 남기지 않는다. 권한을 넓히거나 배포 대상을 바꾸지 말고, workflow·CODEOWNERS·AGENTS 변경에는 관련 검증과 소유자 리뷰가 필요하다. 공개 저장소의 `wiki/`·`raw/` 내용은 외부에 공개된다는 전제를 유지한다.

## 변경 후 확인

workflow나 CODEOWNERS를 바꾼 뒤에는 `git diff --check`와 로컬 Python·Node 검증을 실행하고, 권한·트리거·기준점 계산이 의도대로 유지되는지 diff를 직접 확인한다. Pages 변경은 `_site/`를 커밋하지 않고 `npm run build` 산출물의 동적 기준 경로와 raw 제외를 확인한다.
