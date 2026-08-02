# raw 원본 보존 지침

## 범위

`raw/`는 사용자가 수집한 원본 증거와 첨부파일의 불변 보관 경계다. 이 문서는 `raw/assets/`, `raw/관행/`, `raw/기대권/` 등 하위 자료 묶음에도 적용된다.

## 허용 작업

- 새 원본 파일을 적절한 raw 경로에 추가한다.
- 원본을 읽고 `wiki/`에 요약·분석·출처 페이지를 만든다.
- PDF·이미지 등 이진 첨부는 `raw/assets/`에 보관한다.
- URL 전용 출처는 파일을 가장하지 않고 `raw_sources: []`, `raw_sha256: []`, `source_urls`, `retrieved`로 기록한다.

## 금지 작업

- 기존 raw 파일을 수정·덮어쓰기·이동·이름 변경하거나 통상적으로 삭제하지 않는다.
- 줄바꿈·인코딩·텍스트 정규화, OCR 대체, PDF 재압축을 원본에 적용하지 않는다.
- 기존 파일명과 충돌하는 새 파일을 만들지 않는다.
- raw 파일을 Pages 산출물이나 `_site/`에 복사하지 않는다.
- raw 원본의 내용을 별도 보존 없이 `wiki/` 요약으로 대체하지 않는다.

## 출처 연결

각 원본은 `wiki/sources/`의 하나 이상의 출처 페이지에서 정확한 `raw/...` 경로와 실제 바이트의 SHA-256으로 참조한다. `raw_sources`와 `raw_sha256`은 같은 순서·개수로 대응해야 한다. `.gitattributes`의 `raw/** -text -eol` 정책을 유지한다.

## 예외적 삭제

승인된 삭제만 루트 `raw-removal-approvals.json`의 append-only 승인 항목, 출처의 `removed_raw_refs` tombstone, 별도 감사 로그와 커밋으로 처리한다. 승인 전에는 복구 가능한 별도 파일을 확인하고 사용자에게 범위를 명시한다.

## 검사

새 raw를 추가하면 출처 해시·경로·URL·조회일을 확인하고 `python -I -B scripts/lint_wiki.py --base origin/main`으로 기존 원본 불변성과 출처 커버리지를 검사한다. `raw/` 하위에 별도 AGENTS를 만들지 않는 한 이 규칙은 모든 주제별 폴더에 상속된다.
