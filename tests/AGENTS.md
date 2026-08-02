# Python 검증 테스트 지침

## 범위

`tests/`는 위키 린터·프론트매터 파서·색인 동기화의 Python 단위 테스트 경계다. 사이트 브라우저·HTML 테스트는 `site/tests/`와 상위 `site/AGENTS.md`가 담당한다.

## 테스트 구조

- `test_lint_wiki.py`: 제한 YAML, 진단 코드, 페이지·출처·무결성 규칙을 검증한다.
- `test_sync_wiki.py`: 임시 디렉터리에서 공유 파서와 `wiki/index.md` 생성 규칙을 검증한다.

테스트는 Python 표준 `unittest`, `importlib`, `tempfile.TemporaryDirectory()`를 사용한다. 저장소의 raw·wiki·`_site/`를 테스트 fixture로 직접 덮어쓰지 말고 임시 디렉터리와 합성 페이지를 사용한다.

## 실행

```text
python -I -B -m unittest discover -s tests -p "test_*.py"
python -I -B scripts/sync_wiki.py --check
python -I -B scripts/lint_wiki.py
python -I -B scripts/lint_wiki.py --base origin/main
```

린터·스키마·프론트매터·색인 스크립트를 변경하면 Python 테스트와 현재/기준점 린트를 함께 실행한다. 새 진단 규칙은 오류 코드·메시지·기준점 무결성에 미치는 영향을 테스트한다. 테스트를 통과시키기 위해 원본 보존·로그 append-only·생성 색인 검사를 약화하지 않는다.

## 회귀 테스트 원칙

새 테스트는 재현 가능한 입력과 관찰 가능한 진단·출력 계약을 한 가지씩 고정한다. `AGENTS.md`와 같은 운영 지침 파일은 위키 콘텐츠가 아니므로 페이지 fixture·색인 기대값에 포함하지 않는다. 공유 파서의 오류를 확인할 때는 예외 메시지보다 안정적인 오류 코드를 우선한다.
