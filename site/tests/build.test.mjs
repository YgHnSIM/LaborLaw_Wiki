import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSite } from "../build.mjs";
import { outputPathForRoute } from "../lib/wiki.mjs";
import { createMarkdownRenderer, renderMarkdownPage } from "../lib/render-markdown.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const basePath = "/LaborLaw_Wiki/";
let outputDir;
let result;
let expectedPageCount;
let expectedWikiLinkCount;
let expectedCategoryCounts;

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

before(async () => {
  const wikiDir = path.join(rootDir, "wiki");
  const wikiFiles = (await listFiles(wikiDir)).filter((file) => file.endsWith(".md"));
  expectedPageCount = wikiFiles.length;
  expectedWikiLinkCount = 0;
  expectedCategoryCounts = { concepts: 0, analyses: 0, entities: 0, sources: 0, meta: 0 };
  for (const file of wikiFiles) {
    const relative = path.relative(wikiDir, file).replaceAll("\\", "/");
    const category = relative.includes("/") ? relative.split("/", 1)[0] : "meta";
    expectedCategoryCounts[category] += 1;
    const markdown = await fs.readFile(file, "utf8");
    expectedWikiLinkCount += (markdown.match(/\[\[[^\]\r\n]+\]\]/g) ?? []).length;
  }
  outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "labor-law-wiki-site-"));
  result = await buildSite({
    rootDir,
    outputDir,
    basePath,
    siteUrl: "https://example.test/LaborLaw_Wiki",
    repositoryUrl: "https://github.com/YgHnSIM/LaborLaw_Wiki",
    repositoryRef: "0123456789abcdef"
  });
});

after(async () => {
  if (outputDir) await fs.rm(outputDir, { recursive: true, force: true });
});

test("모든 위키 문서와 링크를 빌드한다", () => {
  assert.equal(result.pageCount, expectedPageCount);
  assert.equal(result.searchCount, expectedPageCount);
  assert.equal(result.wikiLinkCount, expectedWikiLinkCount);
  for (const [category, count] of Object.entries(expectedCategoryCounts)) {
    assert.equal(result.wiki.groups[category].length, count, category);
  }
});

test("빌드 출력 경로가 저장소나 상위 디렉터리를 지울 수 없도록 차단한다", async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "labor-law-wiki-output-guard-"));
  const syntheticRoot = path.join(sandbox, "repository");
  try {
    await assert.rejects(
      buildSite({ rootDir: syntheticRoot, outputDir: syntheticRoot }),
      /안전하지 않은 출력 경로/
    );
    await assert.rejects(
      buildSite({ rootDir: syntheticRoot, outputDir: sandbox }),
      /안전하지 않은 출력 경로/
    );
    await assert.rejects(
      buildSite({ rootDir: syntheticRoot, outputDir: path.join(syntheticRoot, "site", "generated") }),
      /저장소 내부 출력 경로는 _site 또는 dist여야 합니다/
    );
    await assert.rejects(
      buildSite({ rootDir: syntheticRoot, outputDir: path.join(syntheticRoot, "raw", "dist") }),
      /저장소 내부 출력 경로는 _site 또는 dist여야 합니다/
    );
    await assert.rejects(
      buildSite({ rootDir: syntheticRoot, outputDir: path.join(syntheticRoot, "_site", "nested") }),
      /저장소 내부 출력 경로는 _site 또는 dist여야 합니다/
    );
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

test("홈·색인·로그·출처 ID에 안정적인 URL을 부여한다", async () => {
  const byRelative = new Map(result.wiki.pages.map((page) => [page.relativePath, page]));
  assert.equal(byRelative.get("overview.md").route, "/");
  assert.equal(byRelative.get("index.md").route, "/catalog/");
  assert.equal(byRelative.get("log.md").route, "/log/");
  const law = result.wiki.sourcesById.get("SRC-D3A0A79006");
  assert.equal(law.route, "/sources/src-d3a0a79006/");

  for (const page of result.wiki.pages) {
    const info = await fs.stat(outputPathForRoute(outputDir, page.route));
    assert.equal(info.isFile(), true, page.relativePath);
  }
});

test("각 문서는 H1 하나와 GitHub Pages 기준 경로를 사용한다", async () => {
  for (const page of result.wiki.pages) {
    const html = await fs.readFile(outputPathForRoute(outputDir, page.route), "utf8");
    assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, page.relativePath);
    assert.equal(/\[\[[^\]]+\]\]/.test(html), false, page.relativePath);
    assert.equal(/<blockquote[^>]*>\s*<p>\[![A-Z]+\]/.test(html), false, page.relativePath);
    assert.match(html, /href="\/LaborLaw_Wiki\/assets\/styles\.css"/);
    assert.match(html, /src="\/LaborLaw_Wiki\/assets\/app\.js"/);
    assert.match(html, /href="https:\/\/example\.test\/LaborLaw_Wiki\//);
    assert.match(html, /data-design="brutalist-gazette"/);
    assert.match(html, /<meta name="theme-color" content="#0000FF">/);
    if (page.route === "/") {
      const article = html.match(/<article class="prose home-description">([\s\S]*?)<\/article>/)?.[1];
      assert.ok(article, "홈 설명 본문");
      assert.match(html, /<p class="page-summary">이 위키는 대한민국 노동법의 법령, 판례, 행정해석/);
      assert.doesNotMatch(article, /대한민국 노동법의 법령, 판례, 행정해석/);
      assert.match(article, /<h2[^>]*>기준일과 현재 상태/);
      assert.match(html, /영역별 현황/);
      assert.match(html, /근거 연결이 많은 분석/);
      assert.match(html, /최근 검증 문서/);
      assert.match(html, /검토가 필요한 문서/);
      assert.doesNotMatch(html, /class="breadcrumbs"/);
      assert.doesNotMatch(html, /class="page-toc"/);
      assert.doesNotMatch(html, /class="mobile-toc"/);
    } else {
      assert.match(html, /class="page-toc"/);
      assert.match(html, /class="mobile-toc"/);
    }
    assert.match(html, /<dialog[^>]+aria-labelledby="search-dialog-title"/);
    assert.match(html, /data-search-close aria-label="검색 닫기"/);
    assert.match(html, /class="search-filter-toggle"[^>]+data-search-filter-toggle[^>]+aria-expanded="false"[^>]+aria-controls="search-filter-sheet"/);
    assert.match(html, /data-search-filter-summary>0<\/strong>/);
    assert.match(html, /<section class="search-filter-sheet" id="search-filter-sheet" data-search-filter-panel[^>]+hidden>/);
    assert.match(html, /data-search-filter-reset disabled>필터 초기화<\/button>/);
    assert.match(html, /data-search-filter-done>결과 보기<\/button>/);
  }
});

test("생성된 모든 내부 링크 대상이 존재한다", async () => {
  const htmlFiles = (await listFiles(outputDir)).filter((file) => file.endsWith(".html"));
  for (const htmlFile of htmlFiles) {
    const html = await fs.readFile(htmlFile, "utf8");
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1].replace(/&amp;/g, "&");
      if (!href.startsWith(basePath)) continue;
      const relativeHref = href.slice(basePath.length);
      const encodedPath = relativeHref.split(/[?#]/, 1)[0];
      const encodedFragment = relativeHref.includes("#") ? relativeHref.split("#", 2)[1] : "";
      const decodedPath = decodeURIComponent(encodedPath);
      let target = path.join(outputDir, decodedPath);
      if (!path.extname(target)) target = path.join(target, "index.html");
      const info = await fs.stat(target).catch(() => null);
      assert.ok(info?.isFile(), `${path.relative(outputDir, htmlFile)} -> ${href}`);
      if (encodedFragment) {
        const fragment = decodeURIComponent(encodedFragment);
        const targetHtml = await fs.readFile(target, "utf8");
        assert.ok(targetHtml.includes(`id="${fragment}"`), `${path.relative(outputDir, htmlFile)} -> ${href} (fragment)`);
      }
    }
  }
});

test("출처 계보·역인용·원본 링크를 웹 UI에 표시한다", async () => {
  const userPage = result.wiki.pages.find((page) => page.data.title === "사용자성");
  const userHtml = await fs.readFile(outputPathForRoute(outputDir, userPage.route), "utf8");
  assert.ok(userPage.sourcePages.length > 0);
  assert.match(userHtml, new RegExp(`<span>근거 자료</span><small>공식 \\d+ · 보조 \\d+</small><strong>${userPage.sourcePages.length}</strong>`));
  assert.match(userHtml, /\/LaborLaw_Wiki\/sources\/src-beeda8348a\//);

  const citedSource = result.wiki.sourcesById.get("SRC-BEEDA8348A");
  const sourceHtml = await fs.readFile(outputPathForRoute(outputDir, citedSource.route), "utf8");
  assert.match(sourceHtml, /이 자료를 근거로 사용하는 문서/);
  assert.match(sourceHtml, /\/LaborLaw_Wiki\/concepts\/%EC%82%AC%EC%9A%A9%EC%9E%90%EC%84%B1\//);

  const rawSource = result.wiki.pages.find((page) => page.data.raw_sources.length > 0);
  const rawHtml = await fs.readFile(outputPathForRoute(outputDir, rawSource.route), "utf8");
  assert.match(rawHtml, /github\.com\/YgHnSIM\/LaborLaw_Wiki\/blob\/0123456789abcdef\/raw\//);

  const relatedSource = result.wiki.pages.find((page) => page.relatedSources.length > 0);
  const relatedHtml = await fs.readFile(outputPathForRoute(outputDir, relatedSource.route), "utf8");
  assert.match(relatedHtml, new RegExp(relatedSource.relatedSources[0].route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const supersededSource = result.wiki.pages.find((page) => page.supersedingSource);
  const supersededHtml = await fs.readFile(outputPathForRoute(outputDir, supersededSource.route), "utf8");
  assert.match(supersededHtml, /대체 자료/);
  assert.match(supersededHtml, new RegExp(supersededSource.supersedingSource.route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("검색 색인은 제목·별칭·출처 ID·사건번호를 보존한다", async () => {
  const index = JSON.parse(await fs.readFile(path.join(outputDir, "search.json"), "utf8"));
  const worker = index.find((entry) => entry.title === "사용자성");
  assert.ok(worker.aliases.includes("노조법상 사용자성"));
  assert.match(worker.body, /실질적·구체적으로 지배·결정/);

  const home = index.find((entry) => entry.url === basePath);
  assert.match(home.body, /기준일과 현재 상태|주요 영역|최근 보강 내용/);

  const law = index.find((entry) => entry.sourceId === "SRC-D3A0A79006");
  assert.equal(law.publisher, "국가법령정보센터");
  assert.match(law.url, /^\/LaborLaw_Wiki\/sources\/src-d3a0a79006\/$/);

  assert.ok(index.some((entry) => `${entry.title} ${entry.metadata} ${entry.body}`.includes("2020다247190")));
  assert.ok(index.some((entry) => entry.metadata.includes("90퍼센트")));

  const analysis = index.find((entry) => entry.title === "통상임금 판단기준 변화와 법정수당 산정");
  assert.equal(analysis.legalStatus, "current");
  assert.equal(analysis.confidence, "high");
  assert.equal(analysis.asOfDate, "2026-07-10");
  assert.equal(analysis.decisionDate, "2024-12-19");
  assert.equal(analysis.sourceCount, 2);
  assert.equal(analysis.officialSourceCount, 2);
  assert.doesNotMatch(analysis.body, /\[@SRC-/);
  assert.doesNotMatch(analysis.excerpt, /\[@SRC-/);
});

test("문장 단위 근거 표식을 안정적인 출처 항목으로 연결한다", async () => {
  const page = result.wiki.pages.find((item) => item.data.title === "근로시간과 휴게시간 판단 구조");
  const html = await fs.readFile(outputPathForRoute(outputDir, page.route), "utf8");
  assert.match(html, /class="evidence-citation" aria-label="근거 1: 국가법령정보센터 근로기준법">\[1\]<\/a>/);
  assert.match(html, /href="#evidence-SRC-SC-2020DA205837"/);
  assert.match(html, /<li id="evidence-SRC-SC-2020DA205837" tabindex="-1">/);

  const invalidPage = { ...page, relativePath: "invalid.md", body: "문장 [@SRC-NOT-DECLARED]", data: { ...page.data, source_refs: [] } };
  const renderer = createMarkdownRenderer({ lookup: result.wiki.lookup, basePath });
  assert.throws(() => renderMarkdownPage(renderer, invalidPage), /source_refs/);
});

test("Obsidian 콜아웃을 의미 있는 HTML로 변환한다", async () => {
  const warningPage = result.wiki.pages.find((page) => page.data.title === "교섭창구 단일화");
  const warningHtml = await fs.readFile(outputPathForRoute(outputDir, warningPage.route), "utf8");
  assert.match(warningHtml, /class="callout callout-warning"/);
  assert.doesNotMatch(warningHtml, /<blockquote[^>]*>\s*<p>\[!WARNING\]/);

  const notePage = result.wiki.pages.find((page) => page.data.title === "쿠팡CLS 교섭단위 분리 기각");
  const noteHtml = await fs.readFile(outputPathForRoute(outputDir, notePage.route), "utf8");
  assert.match(noteHtml, /class="callout callout-note"/);
});

test("Pages 산출물에 raw 원본이나 PDF를 복제하지 않는다", async () => {
  const files = await listFiles(outputDir);
  const relative = files.map((file) => path.relative(outputDir, file).replaceAll("\\", "/"));
  assert.equal(relative.some((file) => file.startsWith("raw/")), false);
  assert.equal(relative.some((file) => /\.(?:pdf|png)$/i.test(file)), false);
  assert.ok(relative.includes(".nojekyll"));
  assert.ok(relative.includes("sitemap.xml"));
  assert.ok(relative.includes("manifest.webmanifest"));
  assert.equal(relative.includes("robots.txt"), false);
});

test("분류와 404에 맞는 검색엔진 메타데이터를 생성한다", async () => {
  const categoryHtml = await fs.readFile(path.join(outputDir, "concepts", "index.html"), "utf8");
  assert.match(categoryHtml, /<meta property="og:type" content="website">/);
  assert.match(categoryHtml, /"@type":"CollectionPage"/);

  const notFoundHtml = await fs.readFile(path.join(outputDir, "404.html"), "utf8");
  assert.match(notFoundHtml, /<meta name="robots" content="noindex,follow">/);
  assert.match(notFoundHtml, /<meta property="og:type" content="website">/);
  assert.doesNotMatch(notFoundHtml, /application\/ld\+json/);
});

test("origin 루트에 배포할 때만 robots.txt를 생성한다", async () => {
  const rootOutput = await fs.mkdtemp(path.join(os.tmpdir(), "labor-law-wiki-root-site-"));
  try {
    await buildSite({
      rootDir,
      outputDir: rootOutput,
      basePath: "/",
      siteUrl: "https://example.test",
      repositoryUrl: "https://github.com/YgHnSIM/LaborLaw_Wiki",
      repositoryRef: "0123456789abcdef"
    });
    const robots = await fs.readFile(path.join(rootOutput, "robots.txt"), "utf8");
    assert.match(robots, /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
  } finally {
    await fs.rm(rootOutput, { recursive: true, force: true });
  }
});

test("본문 HTML을 실행하지 않고 위키 별칭을 안전한 링크로 변환한다", () => {
  const renderer = createMarkdownRenderer({ lookup: result.wiki.lookup, basePath });
  const html = renderer.render('<script>alert("xss")</script> [[노조법 원문]]');
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="\/LaborLaw_Wiki\/sources\/src-beeda8348a\/"/);
});

test("문서 메타정보 바의 외곽선을 반응형 행에서도 닫는다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  assert.match(css, /\.page-facts\s*\{[^}]*border: 3px solid var\(--ink\);/);
  assert.match(css, /\.page-facts\s*\{\s*display: inline-grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.page-facts > span:nth-child\(even\)\s*\{[^}]*border-left: var\(--rule\);/);
  assert.match(css, /\.page-facts > span:nth-child\(n \+ 3\)\s*\{[^}]*border-top: var\(--rule\);/);
});

test("모바일 바로 찾기 홀수 격자는 빈 셀의 경계선을 닫는다", async () => {
  const homeHtml = await fs.readFile(outputPathForRoute(outputDir, "/"), "utf8");
  assert.match(homeHtml, /class="home-search-suggestions" data-has-empty-cell/);

  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  const mobileStart = css.indexOf("@media (max-width: 38rem)");
  const printStart = css.indexOf("@media print", mobileStart);
  assert.ok(mobileStart >= 0 && printStart > mobileStart, "38rem 모바일 스타일 구간");
  const mobileCss = css.slice(mobileStart, printStart);
  assert.match(mobileCss, /\.home-search-suggestions\[data-has-empty-cell\]::after\s*\{[^}]*content:\s*"";[^}]*border-top:\s*var\(--rule\);[^}]*border-left:\s*var\(--rule\);/);
});

test("모바일 근거 패널은 펼침 표시와 제목이 겹치지 않는다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  const mobileStart = css.indexOf("@media (max-width: 38rem)");
  const printStart = css.indexOf("@media print", mobileStart);
  assert.ok(mobileStart >= 0 && printStart > mobileStart, "38rem 모바일 스타일 구간");
  const mobileCss = css.slice(mobileStart, printStart);
  assert.match(mobileCss, /\.evidence-panel summary,\s*\.cited-by-panel summary\s*\{[^}]*padding-left:\s*3\.6rem;/);
});

test("모바일 문서 메뉴는 하위 문서를 번호와 제목으로 차분하게 구분한다", async () => {
  const conceptPage = result.wiki.pages.find((page) => page.data.title === "교섭창구 단일화");
  const html = await fs.readFile(outputPathForRoute(outputDir, conceptPage.route), "utf8");
  assert.match(html, /class="is-active" aria-current="page"[^>]*>.*?<span class="sidebar-page-label">교섭창구 단일화<\/span>/s);
  assert.match(html, /class="sidebar-pages-all"><a[^>]+aria-label="전체 49개 문서 보기"><span>전체<\/span><strong>49개 문서 보기<\/strong>/);

  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  assert.match(css, /\.sidebar-pages a\s*\{[^}]*grid-template-columns:\s*2rem minmax\(0, 1fr\);[^}]*text-decoration:\s*none;/);
  assert.match(css, /\.sidebar-pages a\.is-active\s*\{[^}]*background:\s*var\(--blue\);[^}]*color:\s*var\(--paper\);/);
  assert.match(css, /\.sidebar-pages \.sidebar-pages-all\s*\{[^}]*position:\s*sticky;[^}]*border-top:\s*var\(--frame\);/);
  assert.match(css, /\.sidebar-pages \.sidebar-pages-all a\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;[^}]*background:\s*var\(--ink\);/);

  const mobileStart = css.indexOf("@media (max-width: 58rem)");
  const compactStart = css.indexOf("@media (max-width: 38rem)", mobileStart);
  assert.ok(mobileStart >= 0 && compactStart > mobileStart, "58rem 모바일 스타일 구간");
  const mobileCss = css.slice(mobileStart, compactStart);
  assert.match(mobileCss, /\.sidebar-pages li \+ li\s*\{[^}]*border-top:\s*0;/);
  assert.match(mobileCss, /\.sidebar-pages a\s*\{[^}]*min-height:\s*2\.9rem;/);
});

test("다음 문서 제목은 화살표 공간을 확보한다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  assert.match(css, /\.prev-next \.next strong\s*\{[^}]*margin-right:\s*2rem;/);
});

test("본문 글꼴 선택은 리디바탕을 기본값으로 저장하고 복원한다", async () => {
  const homeHtml = await fs.readFile(outputPathForRoute(outputDir, "/"), "utf8");
  assert.match(homeHtml, /data-body-font="ridibatang"/);
  assert.match(homeHtml, /<section class="reader-settings" aria-label="읽기 설정">/);
  assert.match(homeHtml, /<select id="body-font-select" data-body-font-select>/);
  assert.match(homeHtml, /<option value="ridibatang">리디바탕<\/option>/);
  assert.match(homeHtml, /<option value="maruburi">마루부리<\/option>/);
  assert.match(homeHtml, /<option value="system">시스템 바탕<\/option>/);
  assert.match(homeHtml, /<option value="d2coding">D2Coding<\/option>/);
  assert.match(homeHtml, /localStorage\.getItem\("laborlaw-body-font"\)/);

  const app = await fs.readFile(path.join(rootDir, "site", "assets", "app.js"), "utf8");
  assert.match(app, /select\.value = root\.dataset\.bodyFont/);
  assert.match(app, /localStorage\.setItem\("laborlaw-body-font", select\.value\)/);

  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  assert.match(css, /:root\[data-body-font="maruburi"\]\s*\{[^}]*--font-body:\s*"MaruBuri"/);
  assert.match(css, /:root\[data-body-font="system"\]\s*\{[^}]*--font-body:\s*"Times New Roman"/);
  assert.match(css, /:root\[data-body-font="d2coding"\]\s*\{[^}]*--font-body:\s*"D2Coding"/);
  assert.match(css, /\.reader-settings select\s*\{[^}]*font-family:\s*var\(--font-body\);/);
});

test("검색·분류·모바일 목차가 실제 문서 메타데이터를 사용한다", async () => {
  const homeHtml = await fs.readFile(outputPathForRoute(outputDir, "/"), "utf8");
  assert.match(homeHtml, /data-search-preset-area="집단노동"/);
  assert.match(homeHtml, new RegExp(`<span>검증 완료</span><div><strong>${result.wiki.stats.statuses.active ?? 0}</strong>개</div>`));
  assert.match(homeHtml, new RegExp(`<span>검토 필요</span><div><strong>${result.wiki.stats.statuses.review ?? 0}</strong>개</div>`));
  assert.match(homeHtml, new RegExp(`<time datetime="${result.wiki.stats.knowledgeAsOf}">`));
  assert.match(homeHtml, /data-search-category/);
  assert.match(homeHtml, /data-search-status/);
  assert.match(homeHtml, /data-search-area/);
  assert.match(homeHtml, /data-search-source-type/);
  assert.match(homeHtml, /data-search-legal-status/);
  assert.match(homeHtml, /data-search-date-kind/);
  assert.match(homeHtml, /role="combobox"[^>]+aria-controls="search-results"[^>]+aria-expanded="false"/);
  assert.match(homeHtml, /<div[^>]+id="search-results"/);
  assert.match(homeHtml, /<div[^>]+role="listbox"/);

  const categoryHtml = await fs.readFile(path.join(outputDir, "concepts", "index.html"), "utf8");
  assert.match(categoryHtml, /data-category-filters/);
  assert.match(categoryHtml, /data-document-card data-status="draft"/);

  const articlePage = result.wiki.pages.find((page) => page.data.title === "교섭창구 단일화");
  const articleHtml = await fs.readFile(outputPathForRoute(outputDir, articlePage.route), "utf8");
  assert.match(articleHtml, /<details class="mobile-toc" data-mobile-toc>/);
  assert.match(articleHtml, /<progress max="100" value="0" aria-label="문서 읽기 진행률"/);

  const app = await fs.readFile(path.join(rootDir, "site", "assets", "app.js"), "utf8");
  assert.match(app, /appendHighlightedText/);
  assert.match(app, /visibleLimit \+= 12/);
  assert.match(app, /window\.history\.replaceState/);
  assert.match(app, /new Worker/);
  assert.match(app, /aria-activedescendant/);
  assert.match(app, /search-source/);
  assert.match(app, /results\.inert = blocksResults/);
  assert.match(app, /dialog\.addEventListener\("cancel"/);
  assert.match(app, /from "\.\/search-core\.js"/);

  const worker = await fs.readFile(path.join(rootDir, "site", "assets", "search-worker.js"), "utf8");
  assert.match(worker, /from "\.\/search-core\.js"/);
  for (const asset of ["app.js", "search-core.js", "search-worker.js"]) {
    assert.ok((await fs.stat(path.join(outputDir, "assets", asset))).isFile(), asset);
  }

  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.doesNotMatch(css, /@view-transition|view-transition-name/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /\.search-dialog\[open\]\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto auto auto minmax\(0, 1fr\);/);
  assert.match(css, /\.search-filter-sheet\s*\{[^}]*grid-area:\s*4 \/ 1;[^}]*overflow-y:\s*auto;/);
  assert.match(css, /@media \(max-width: 38rem\) and \(max-height: 42rem\)/);
});

test("Brutalist 법률 공보형 디자인 토큰을 일관되게 사용한다", async () => {
  const sourceFiles = [
    path.join(rootDir, "site", "assets", "styles.css"),
    path.join(rootDir, "site", "templates.mjs"),
    path.join(rootDir, "site", "build.mjs"),
    path.join(rootDir, "site", "assets", "favicon.svg")
  ];
  const sources = await Promise.all(sourceFiles.map((file) => fs.readFile(file, "utf8")));
  const css = sources[0];
  const combined = sources.join("\n");
  const allowedColors = new Set(["#000000", "#ffffff", "#0000ff"]);
  const normalizeHex = (value) => {
    const hex = value.toLowerCase().slice(1);
    return `#${hex.length === 3 ? [...hex].map((part) => part.repeat(2)).join("") : hex}`;
  };
  for (const color of combined.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
    assert.ok(allowedColors.has(normalizeHex(color)), `허용되지 않은 색상 ${color}`);
  }
  assert.match(css, /--font-sans:\s*Arial, system-ui, sans-serif;/);
  assert.match(css, /--font-serif:\s*"Times New Roman", serif;/);
  assert.match(css, /--font-body:\s*"RIDIBatang", "Times New Roman", serif;/);
  assert.match(css, /--font-heading:\s*"D2Coding", "Courier New", monospace;/);
  assert.match(css, /--font-mono:\s*"Courier New", monospace;/);
  assert.match(css, /@font-face[\s\S]*font-family:\s*"MaruBuri"/);
  assert.match(css, /@font-face[\s\S]*font-family:\s*"D2Coding"/);
  assert.match(css, /@font-face[\s\S]*font-family:\s*"RIDIBatang"/);
  assert.match(css, /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-family:\s*var\(--font-heading\);/);
  assert.match(css, /\.prose h2\s*\{[^}]*font-family:\s*var\(--font-heading\);/);
  assert.match(css, /--shadow:\s*8px 8px 0 #000;/);
  assert.match(css, /--shadow-blue:\s*8px 8px 0 #0000ff;/);
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient|\brgba?\(|\bhsla?\(|oklch\(|color-mix\(|text-shadow|filter:\s*(?:blur|drop-shadow)|transition\s*:/i);
  for (const radius of css.matchAll(/border-radius:\s*([^;]+);/gi)) {
    assert.equal(radius[1].trim(), "0", "둥근 모서리를 사용할 수 없습니다");
  }
  assert.doesNotMatch(css, /fonts\.(?:googleapis|gstatic)\.com|https?:\/\//i);
  const manifest = JSON.parse(await fs.readFile(path.join(outputDir, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.background_color, "#FFFFFF");
  assert.equal(manifest.theme_color, "#0000FF");
});

test("로컬 본문·제목 글꼴과 정적 자산 예산을 지킨다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  assert.match(css, /url\("\.\/fonts\/maru-buri\/MaruBuri-Regular\.otf"\)/);
  assert.match(css, /url\("\.\/fonts\/maru-buri\/MaruBuri-Bold\.otf"\)/);
  assert.match(css, /url\("\.\/fonts\/D2Coding-Regular\.ttf"\)/);
  assert.match(css, /url\("\.\/fonts\/D2Coding-Bold\.ttf"\)/);
  assert.match(css, /url\("\.\/fonts\/ridi-batang\/RIDIBatang\.otf"\)/);
  const fontDir = path.join(outputDir, "assets", "fonts", "maru-buri");
  const fontFiles = ["MaruBuri-Regular.otf", "MaruBuri-Bold.otf"];
  const headingFontDir = path.join(outputDir, "assets", "fonts");
  const headingFontFiles = ["D2Coding-Regular.ttf", "D2Coding-Bold.ttf"];
  const ridiFontDir = path.join(outputDir, "assets", "fonts", "ridi-batang");
  const ridiFontFile = path.join(ridiFontDir, "RIDIBatang.otf");
  const fontStats = await Promise.all(fontFiles.map((file) => fs.stat(path.join(fontDir, file))));
  const headingFontStats = await Promise.all(headingFontFiles.map((file) => fs.stat(path.join(headingFontDir, file))));
  const fontHeaders = await Promise.all(fontFiles.map(async (file) => {
    const handle = await fs.open(path.join(fontDir, file), "r");
    try {
      const header = Buffer.alloc(4);
      await handle.read(header, 0, header.length, 0);
      return header.toString("ascii");
    } finally {
      await handle.close();
    }
  }));
  const headingFontHeaders = await Promise.all(headingFontFiles.map(async (file) => {
    const handle = await fs.open(path.join(headingFontDir, file), "r");
    try {
      const header = Buffer.alloc(4);
      await handle.read(header, 0, header.length, 0);
      return header.toString("hex");
    } finally {
      await handle.close();
    }
  }));
  assert.deepEqual(fontHeaders, ["OTTO", "OTTO"]);
  assert.deepEqual(headingFontHeaders, ["00010000", "00010000"]);
  const ridiFont = await fs.readFile(ridiFontFile);
  assert.equal(ridiFont.subarray(0, 4).toString("ascii"), "OTTO");
  assert.equal(createHash("sha256").update(ridiFont).digest("hex"), "f13a49c0815d254ac15e392953a0b056613dec08ceb378e54eeed14c4fda9a54");
  const license = await fs.readFile(path.join(fontDir, "OFL.txt"), "utf8");
  assert.match(license, /Reserved Font Name[\s\S]*MaruBuri/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  const headingLicense = await fs.readFile(path.join(headingFontDir, "OFL.txt"), "utf8");
  assert.match(headingLicense, /Reserved Font Name[\s\S]*D2Coding/);
  assert.match(headingLicense, /SIL OPEN FONT LICENSE[\s\S]*Version 1\.1/);
  const ridiLicense = await fs.readFile(path.join(ridiFontDir, "OFL.txt"), "utf8");
  assert.match(ridiLicense, /Copyright \(c\) RIDI Corporation/);
  assert.match(ridiLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
  const ridiSource = await fs.readFile(path.join(ridiFontDir, "SOURCE.md"), "utf8");
  assert.match(ridiSource, /ridicorp\.com\/ridibatang\//);
  assert.match(ridiSource, /F13A49C0815D254AC15E392953A0B056613DEC08CEB378E54EEED14C4FDA9A54/);
  const cssSize = (await fs.stat(path.join(outputDir, "assets", "styles.css"))).size;
  const javascriptFiles = (await listFiles(path.join(outputDir, "assets"))).filter((file) => file.endsWith(".js"));
  const javascriptStats = await Promise.all(javascriptFiles.map((file) => fs.stat(file)));
  const javascriptSize = javascriptStats.reduce((total, stat) => total + stat.size, 0);
  const searchSize = (await fs.stat(path.join(outputDir, "search.json"))).size;
  const fontSize = fontStats.reduce((total, stat) => total + stat.size, 0);
  const readingFontSize = fontSize + ridiFont.length;
  const headingFontSize = headingFontStats.reduce((total, stat) => total + stat.size, 0);
  assert.ok(cssSize < 80_000, `CSS ${cssSize} bytes`);
  assert.ok(javascriptSize < 36_000, `JavaScript 합계 ${javascriptSize} bytes`);
  assert.ok(searchSize < 600_000, `검색 색인 ${searchSize} bytes`);
  assert.ok(readingFontSize < 3_200_000, `본문 글꼴 ${readingFontSize} bytes`);
  assert.ok(headingFontSize < 9_000_000, `제목 글꼴 ${headingFontSize} bytes`);
});
