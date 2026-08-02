# 유지관리 스크립트 지침

## 범위

`scripts/`는 위키 스키마를 검사·변환·색인하는 Python 유지관리 계층이다. 스크립트 변경은 루트 규칙과 `schema/wiki-v2.json`의 계약을 동시에 만족해야 한다.

## 도구 역할

- `frontmatter.py`: 의존성 없는 제한 YAML 부분집합 파서.
- `schema.py`: JSON 정본에서 스키마 상수·열거형을 로드한다.
- `lint_wiki.py`: 프론트매터, 태그, 출처 계보, 링크, 색인, 로그, raw 해시와 `--base` 무결성을 검사한다.
- `sync_wiki.py`: 모든 위키 페이지를 읽어 `wiki/index.md`를 결정적으로 생성·검사한다.
- `migrate_schema_v2.py`: 일회성 v1→v2 변환 도구. raw를 읽거나 쓰지 않지만 wiki 파일을 변경한다.

## 실행 계약

Python 도구는 격리·바이트코드 비생성 모드로 실행한다.

```text
python -I -B -m unittest discover -s tests -p "test_*.py"
python -I -B scripts/sync_wiki.py --check
python -I -B scripts/lint_wiki.py --strict-warnings
python -I -B scripts/lint_wiki.py --base origin/main
```

`sync_wiki.py`를 실제 생성에 사용할 때만 `--check`를 생략한다. 생성 결과인 `wiki/index.md` 외의 파일을 임의로 덮어쓰지 않는다.

## 스키마·원본 경계

새 필드·상태·출처 관계는 먼저 `schema/wiki-v2.json`과 기존 린터 호출부를 검토한다. v1 필드 호환을 이유로 `legal_status`, `related_source_refs`, `superseded_by`를 새 페이지에 쓰지 않는다. 모든 raw 접근은 읽기 전용이며, 마이그레이션도 raw 파일의 이름·경로·바이트를 변경하지 않는다.

`lint_wiki.py` 또는 스키마 부트스트랩을 바꾸면 CI의 trusted base-linter 비교가 제한될 수 있다. 따라서 Python 단위 테스트, 현재 린트, `--strict-warnings`, `--base`, 색인 검사와 관련 사이트 테스트를 모두 확인한다.

## 코드 변경 주의

진단 코드·검사 순서·공유 파서의 동작을 바꿀 때는 기존 오류 코드와 기준점 무결성 검사를 보존한다. 테스트가 기대하는 임시 디렉터리·LF·UTF-8 NFC·원본 해시 규칙을 우회하지 않는다. 스크립트는 사이트 산출물 `_site/`를 직접 수정하지 않는다.
