# 대한민국 노동법 위키

대한민국 노동법의 법령·판례·행정해석·노동위원회 판정·입법자료를 원본에서 분석 페이지까지 추적할 수 있게 정리하는 Obsidian 기반 지식베이스입니다. 같은 문서를 GitHub Pages 정적 웹 위키로도 제공합니다. 원본은 `raw/`에 바이트 그대로 보존하고, `wiki/` 문서는 안정적인 출처 ID와 원본 해시 또는 버전 고정 URL로 근거를 연결합니다.

## 빠른 시작

1. 새 파일은 `raw/` 또는 `raw/assets/`에 **추가만** 합니다. URL만 있는 자료는 원본 파일을 만들지 않아도 됩니다.
2. `wiki/sources/`에 출처 요약을 만들고 `source_id`, 자료 유형, 발행자, 원본 경로·SHA-256 또는 URL·조회일을 기록합니다.
3. 개념·개체·분석 페이지의 `source_refs`에 출처 ID를 연결합니다.
4. `wiki/index.md`와 `wiki/log.md`를 갱신합니다. 로그는 기존 항목을 고치지 않고 새 항목만 추가합니다.
5. Python 3.10 이상에서 검사를 실행합니다.

```powershell
python -I -B -m unittest discover -s tests -p "test_*.py"
python -I -B scripts/lint_wiki.py
python -I -B scripts/lint_wiki.py --base origin/main
npm ci
npm test
npm run build
```

두 번째 명령은 현재 트리를 검사하고, 세 번째 명령은 기준 브랜치 이후 원본 불변성, 로그 보존, 위키 변경 시 로그 갱신까지 확인합니다. 검토기한 경과 경고도 실패로 처리하려면 `--strict-warnings`를 붙입니다.

## 구조

```text
raw/                    수정하지 않는 원본 자료
raw/assets/             PDF·이미지 등 원본 첨부
wiki/sources/           출처별 요약과 출처 ID·계보
wiki/concepts/          노동법 개념·조문·판단기준
wiki/entities/          기관·법원·위원회·단체
wiki/analyses/          쟁점·판례·입법사·실무 분석
wiki/meta/              템플릿·방법론·용어집
wiki/index.md           전체 페이지 카탈로그
wiki/log.md             append-only 작업 감사기록
scripts/lint_wiki.py    의존성 없는 저장소 검사기
site/                   정적 웹 위키 생성기·화면·브라우저 자산·테스트
package.json            웹 빌드 명령과 고정된 Node 의존성
_site/                  생성된 웹 사이트(커밋하지 않음)
```

## 웹 사이트 로컬 실행

Node.js 22 이상에서 의존성을 설치하고 정적 사이트를 생성합니다. `wiki/`가 단일 콘텐츠 원본이며 생성 결과인 `_site/`는 Git에 추가하지 않습니다.

```powershell
npm ci
npm test
npm run build
npm run preview
```

`npm run preview`는 빌드 뒤 `http://127.0.0.1:4173/`에서 로컬 서버를 엽니다. 웹 생성기는 다음 규칙을 적용합니다.

- `overview.md`는 홈페이지, `index.md`는 `/catalog/`, `log.md`는 `/log/`로 만듭니다.
- 출처 페이지는 파일명 대신 `/sources/{source_id}/` 형태의 안정적인 주소를 사용합니다.
- 파일명·제목·별칭을 기준으로 Obsidian 위키링크를 해석하고 콜아웃과 표를 웹 HTML로 변환합니다.
- 일반 문서에는 `source_refs` 기반 근거 목록을, 출처 문서에는 이를 사용한 문서의 역참조를 표시합니다.
- 검색은 제목, 별칭, 본문, 출처 ID, 발행기관, 사건번호·의안번호를 대상으로 합니다.
- `raw/` 파일은 Pages 산출물에 복제하지 않고 배포 커밋에 고정된 GitHub 원본 링크로 연결합니다.

GitHub Pages 프로젝트 경로를 로컬에서 재현하려면 다음처럼 환경변수를 지정할 수 있습니다.

```powershell
$env:SITE_BASE='/LaborLaw_Wiki/'
$env:SITE_URL='https://yghnsim.github.io/LaborLaw_Wiki'
npm run build
```

## GitHub Pages 배포

`.github/workflows/pages.yml`은 `main` 브랜치 push와 수동 실행에서 Python 위키 검사, 웹 생성기 테스트, 프로덕션 빌드를 차례로 통과한 결과만 GitHub Pages에 배포합니다. GitHub의 실제 `base_path`를 빌드에 전달하므로 프로젝트 사이트와 사용자 사이트·커스텀 도메인을 같은 코드로 처리합니다.

첫 배포 전에 저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 지정해야 합니다. 설정 전에 먼저 push해 첫 실행이 실패했다면, 설정을 마친 뒤 Actions 화면에서 실패한 실행을 다시 실행하거나 `Deploy wiki to GitHub Pages`를 수동 실행합니다. 워크플로가 성공하면 기본 주소는 `https://yghnsim.github.io/LaborLaw_Wiki/`입니다. 저장소가 공개되어 있으므로 위키 본문과 저장소에 커밋된 원본 자료도 공개 범위에 포함됩니다.

프로젝트 Pages는 origin 루트가 아니라 `/LaborLaw_Wiki/` 아래에 배포되므로 저장소만으로 origin의 `/robots.txt`를 제어할 수 없습니다. 검색엔진 등록이 필요하면 생성된 `https://yghnsim.github.io/LaborLaw_Wiki/sitemap.xml`을 Search Console 등에 직접 제출합니다. 사용자·조직 Pages 또는 커스텀 도메인처럼 사이트가 origin 루트에 배포될 때만 생성기가 유효한 `robots.txt`를 만듭니다.

## 문서 상태

| 상태 | 의미 |
|---|---|
| `draft` | 구조나 근거가 아직 불완전한 초안 |
| `active` | 현재 근거로 검토되어 일반 탐색에 사용하는 문서 |
| `review` | 모순 경고, 불확실한 후속 상태, 기준일 경과 등 재검토가 필요한 문서 |
| `archived` | 역사적 기록으로 보존하지만 현행 설명으로 사용하지 않는 문서 |

본문에 `> [!WARNING]`이 있으면 해결 전까지 반드시 `review` 상태를 사용합니다. 진행 중 사건은 `event_status`와 `next_review_date`로 다음 확인 시점을 기록합니다.

## 출처와 최신성 원칙

- 국가법령정보센터, 법원·헌법재판소, 고용노동부·노동위원회, 국회 등 공식 원문을 우선합니다.
- 기사·해설의 발행자와 기사에 등장하는 기관을 구분합니다.
- 법령은 확인 기준일, 대표 시행일, 법률번호와 `lsiSeq` 등 버전 식별자, 버전 고정 URL을 기록합니다.
- 원본 파일이 있는 출처는 실제 SHA-256을 기록하고, URL 전용 출처는 조회일을 기록합니다.
- 작성 세부 규칙과 통제어휘는 `AGENTS.md`를 따릅니다.

## 백업과 복구

- 작업 전 `git status`를 확인하고, 검사를 통과한 작은 단위로 커밋합니다. 중요한 기준점에는 주석 태그나 별도 백업 브랜치를 둡니다.
- 저장소 사본과 원본 바이너리 백업을 서로 다른 매체에 보관합니다. 저장소 원격 하나만 원본 보존 수단으로 간주하지 않습니다.
- 위키 문서를 복구할 때는 원하는 커밋에서 해당 경로만 복원한 뒤 검사와 새 로그 항목을 남깁니다.
- `raw/` 복구는 정상 사본의 해시를 먼저 확인한 뒤 수행합니다. 기존 원본을 덮어쓰거나 이름을 재사용하지 말고, 손상·복구 사실을 별도 감사기록으로 남깁니다.
- 저장소 전체를 되감는 파괴적 명령은 사용하지 않습니다. 사용자 작업이 섞여 있으면 파일 단위 복구를 우선합니다.

## 바이너리 성장 정책

- 같은 자료의 중복 파일을 추가하지 말고 기존 `source_id`와 원본 경로를 먼저 검색합니다.
- 큰 파일은 추가 전에 출처의 영속성, 라이선스·개인정보, 중복 여부를 확인합니다. 추가한 뒤에는 압축·교체하지 않습니다.
- 10 MiB 이상 파일은 필요성을 기록하고, 50 MiB 이상 파일은 기본적으로 영구 URL과 외부 보존소를 사용한 URL 전용 출처로 관리합니다.
- 50 MiB 이상 파일을 반드시 버전 관리해야 한다면 별도 변경으로 Git LFS 또는 전용 보존 방식을 먼저 합의합니다. 기존 Git 원본을 사후에 LFS로 옮기는 이력 재작성은 사용자 승인 없이 하지 않습니다.

## Obsidian 설정 정책

`.obsidian/`, 휴지통, 운영체제·편집기 임시파일은 개인 환경이므로 Git에서 제외합니다. 공용 플러그인이나 설정이 꼭 필요해지면 전체 `.obsidian/`을 해제하지 말고, 보안·이식성을 검토한 선택 파일만 별도 정책 변경으로 추적합니다. 위키 문서는 Obsidian 설정 없이도 일반 Markdown으로 읽고 검사할 수 있어야 합니다.

## 자동 검사

GitHub Actions는 먼저 린터 단위 테스트를 실행한 뒤 push와 pull request에서 `scripts/lint_wiki.py`를 실행합니다. 검사는 프론트매터·통제어휘·날짜·태그·구조화 판정 이력, H1·관련 항목, 위키링크·섹션, 색인 수록·소스 수, 출처 ID·원본 경로·해시·URL 조회일, 법령 버전, 경고 상태, UTF-8·NFC를 확인합니다. pull request는 대상 커밋, 일반 push는 직전 커밋을 기준으로 기존 원본 파일과 과거 로그의 불변성도 검사합니다. 별도의 Pages 워크플로는 웹 링크 해소, 단일 H1, 출처 계보·역참조, 검색 색인, 프로젝트 기준 경로와 `raw/` 미포함을 검사한 뒤에만 배포합니다.

CI 파일 자체의 무력화를 막으려면 GitHub 저장소의 기본 브랜치 ruleset에서 pull request와 Code Owner 승인을 필수로 하고, `Lint wiki / lint`를 required status check로 지정해야 합니다. 우회 권한은 최소화하며, `.github/CODEOWNERS`가 지정한 `scripts/` 전체, `tests/`, 워크플로, `AGENTS.md`, CODEOWNERS 자체의 변경은 `@YgHnSIM`의 승인을 받습니다. PR 검사는 기준 브랜치의 린터를 임시 복사해 먼저 실행한 뒤 현재 브랜치 린터도 실행하며, 두 실행 모두 Python 격리 모드로 저장소 내부 모듈의 import 가로채기를 차단합니다.
