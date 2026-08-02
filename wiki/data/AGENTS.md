# 연구 쟁점 데이터 지침

## 범위

`research-issues.json`은 위키 문서가 아니라 사이트의 연구 데스크를 구동하는 정본 JSON이다. 로더는 `site/lib/research-issues.mjs`와 `site/lib/wiki.mjs`, 통합 테스트가 소비한다.

## 데이터 계약

최상위 키는 `version`, `search_suggestions`, `page_refs`, `issues`다. 현재 `version`은 `1`이다. 각 `issues` 항목은 `id`, `question`, `description`, `stages`를 갖고, 각 stage는 `id`, `label`, `pageRefs`를 갖는다.

- issue·stage ID는 저장소 전체에서 안정적이고 중복되지 않는 소문자 kebab-case를 사용한다.
- 질문·설명·단계·pageRefs는 비어 있지 않아야 하며 각 stage의 `pageRefs`는 중복되지 않는다.
- `pageRefs`는 기존 비출처 위키 페이지의 제목·별칭·파일 stem만 가리킨다. 출처 페이지를 직접 지정하지 않는다.
- 페이지 제목·별칭을 바꾸면 모든 `pageRefs`와 위키링크를 함께 검색한다.
- JSON 문법과 로더가 요구하는 구조를 유지하며 임의의 키를 추가하지 않는다.

## 변경·검사

이 파일을 변경하면 연구 쟁점 단위 테스트와 전체 사이트 테스트를 실행한다.

```text
npm test
npm run build
python -I -B scripts/lint_wiki.py
```

연구 데이터 변경도 지식베이스 변경이므로 `wiki/log.md`에 append-only 기록을 추가한다. `wiki/index.md`는 데이터 파일을 직접 나열하지 않지만 위키 페이지 변경이 함께 있으면 `scripts/sync_wiki.py --check`도 실행한다. JSON 오류나 해소되지 않는 pageRefs는 사이트 빌드를 실패시켜야 하며, 테스트를 우회하지 않는다.

## 런타임 영향

`pageRefs` 해소는 제목·별칭·파일 stem을 기준으로 하므로 문서 이동·개명은 Markdown 링크와 함께 검토한다. 이 디렉터리의 `AGENTS.md`는 구조화 데이터가 아니며 사이트 페이지 수·검색 색인·연구 쟁점 membership에 포함되지 않는다.
