# 정적 사이트 지침

## 범위

`site/`는 `wiki/`를 GitHub Pages용 정적 HTML로 변환하고 브라우저 동작을 제공하는 Node ESM 애플리케이션 경계다. Node 버전 계약은 `package.json`의 `>=22`, CI 기준은 Node 24다.

## 실행 경로

```text
wiki/ + wiki/data/ → site/lib/wiki.mjs → site/build.mjs
→ site/lib/render-markdown.mjs + site/templates.mjs
→ _site/ HTML·검색색인·SEO 파일 → site/assets/app.js
```

- `build.mjs`: 빌드 진입점. `_site/`를 좁게 정리한 뒤 페이지·자산·검색색인·sitemap·manifest·404를 생성한다.
- `serve.mjs`: 생성된 `_site/`만 로컬에서 제공하며 경로 탈출을 막는다.
- `lib/wiki.mjs`: 프론트매터·경로·출처·연구 데이터 모델을 로드한다.
- `lib/render-markdown.mjs`와 `lib/wiki-syntax.mjs`: Markdown, 위키링크, 근거 표식을 렌더링한다.
- `templates.mjs`: HTML 구조와 브라우저가 의존하는 `data-*`·ID·ARIA 계약을 소유한다.
- `assets/app.js`: 탐색·검색·필터·탭·읽기 진행·근거 패널의 브라우저 런타임이다. `search-core.js`와 `search-worker.js`는 검색 계약을 분담한다.

## URL·산출물 계약

개요 `/`, 색인 `/catalog/`, 로그 `/log/`, 최신성 `/freshness/`, 콘텐츠 유형별 `/concepts/`, `/analyses/`, `/entities/`, `/cases/`, `/sources/`, `/meta/` 경로를 보존한다. GitHub Pages의 `SITE_BASE`·`SITE_URL`을 하드코딩하지 말고 빌드 환경값을 사용한다. raw·PDF·PNG를 `_site/`에 복사하지 않는다.

`_site/`는 생성물이며 직접 편집·커밋하지 않는다. 빌드의 재귀 삭제 대상은 `_site/` 또는 테스트용 임시 디렉터리로만 유지한다. 저장소·`raw/`·`site/` 자체를 출력 경로로 사용하지 않는다.

## 변경별 검사

```text
npm ci
npm test
npm run build
```

`lib/`, `build.mjs`, `templates.mjs`, `serve.mjs`, CSS, 글꼴, `app.js` 또는 검색 코드를 바꾸면 위 세 명령을 실행한다. Markdown·출처 문서만 바꾼 경우에도 `npm test`로 링크·근거·HTML 계약을 확인한다. `site/tests/`는 Node 내장 test runner를 사용하고, 브라우저 자동화 대신 생성 HTML·문자열·산출물 계약을 검사한다.

## 수동 확인 경계

화면·템플릿·브라우저 동작 변경은 `npm run preview`로 생성물을 제공한 뒤 데스크톱·모바일에서 메뉴, 검색, 필터, 탭, 근거 링크, 한국어 deep link, 404, Pages 하위 경로를 확인한다. 키보드 포커스·ARIA 상태·테이블 overflow·글꼴과 `prefers-reduced-motion`도 점검한다. 테스트가 통과해도 이 수동 확인을 대체하지 않는다.
