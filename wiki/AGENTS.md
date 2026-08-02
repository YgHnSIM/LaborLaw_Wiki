# wiki 콘텐츠 운영 지침

## 범위

`wiki/`는 원본 자료에서 파생된 노동법 지식의 관리 경계다. 저장소 전체 규칙은 루트 `AGENTS.md`, 필드·열거형의 정본은 `schema/wiki-v2.json`을 따른다. 이 파일은 위키 콘텐츠에만 필요한 구분을 보충한다.

## 구조

- `sources/`: 원문·URL 출처의 요약과 계보. 안정적인 `source_id`를 만든다.
- `concepts/`: 노동법 개념·조문·판단기준.
- `entities/`: 노동법상 독립적인 기관·법원·단체·조직.
- `analyses/`: 판례 비교, 법제사, 제도 평가와 같은 해석 문서.
- `cases/`: 사건번호·당사자·쟁점·진행 상태를 기록하는 사건 계층.
- `meta/`: 방법론·용어·입법절차 안내.
- `data/`: Markdown이 아닌 사이트 소비용 구조화 데이터. 별도 `wiki/data/AGENTS.md`가 계약을 정한다.

## 작성 계약

- 모든 Markdown 페이지는 UTF-8 NFC, 제한된 YAML 프론트매터, 한 줄 `summary`, 하나의 H1, 마지막 `## 관련 항목`을 갖는다.
- `type/*`와 `status/*` 태그는 디렉터리와 프론트매터의 유형·상태와 일치시킨다.
- 일반 페이지는 `source_refs`로 출처 ID를 참조하고, 출처 페이지는 `source_refs`를 사용하지 않는다.
- v2에서는 `normative_status`, `record_status`, `source_relations`를 사용하며 폐기된 v1 필드를 새 문서에 재도입하지 않는다.
- 사건 당사자는 사건 페이지의 `parties`에 보존한다. 노동법상 독립적인 의미가 있을 때만 `entities/` 문서를 만들고 `party_entity_refs`로 연결한다.

## 근거와 링크

고위험 주장에는 등록된 `[@SRC-ID]` 또는 페이지·조문 위치가 있는 표식을 사용한다. 출처 페이지 본문으로 향하는 위키링크를 일반 문서에 만들지 말고, `source_refs`와 근거 표식을 사용한다. 개념·개체·분석·사건 사이의 내부 링크는 실제 제목·별칭으로 해소되어야 하며 자기 링크와 빨간 링크를 만들지 않는다.

## 특수 파일

- `index.md`: `python -I -B scripts/sync_wiki.py`가 생성한다. 생성 카탈로그를 수동 편집하지 말고 `--check`로 확인한다.
- `log.md`: append-only 감사기록이다. 기존 항목을 고치거나 삭제하지 않고 새 항목을 마지막 `## 관련 항목` 앞에 추가한다.
- `overview.md`: 작성되는 홈페이지다. 색인 내용을 복사하지 말고 지식베이스 범위와 탐색 경로를 안내한다.

## 작업 경계

새 원본은 먼저 `raw/`에 보존하고, 그 후 출처 요약·관련 페이지·색인·로그를 갱신한다. 기존 raw 파일은 이 경계에서도 수정하지 않는다. 페이지명을 바꾸면 연구 데이터의 제목·별칭 기반 `pageRefs`와 위키링크를 함께 확인한다.

## 검사

위키 문서 변경 후 다음을 실행한다.

```text
python -I -B -m unittest discover -s tests -p "test_*.py"
python -I -B scripts/sync_wiki.py --check
python -I -B scripts/lint_wiki.py
python -I -B scripts/lint_wiki.py --base origin/main
npm test
```

사이트 생성기나 화면을 바꾼 경우 `npm run build`도 실행한다. 검사에서 발견한 모순·경고는 숨기지 말고 문서 상태와 로그에 반영한다.

## 지침 파일 경계

`AGENTS.md`와 `CLAUDE.md`는 이 디렉터리 계층의 운영 지침이지 위키 페이지가 아니다. 색인·린터·사이트 로더는 이 파일명을 콘텐츠 수집에서 제외하므로, 지침을 페이지 프론트매터로 위장하거나 `wiki/index.md`에 수동으로 추가하지 않는다.
