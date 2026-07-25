import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSite } from "../build.mjs";
import { outputPathForRoute, siteHref } from "../lib/wiki.mjs";
import { createMarkdownRenderer, renderMarkdownPage } from "../lib/render-markdown.mjs";
import { renderPage } from "../templates.mjs";

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

function knowledgeContextMarkup(html) {
  const context = html.match(/<aside class="knowledge-context" id="knowledge-context" data-knowledge-context[^>]*>([\s\S]*?)<\/aside>/)?.[1];
  assert.ok(context, "지식 연결 패널이 생성된다");
  return context;
}

function contextGroupMarkup(context, name) {
  const group = context.match(new RegExp(`<section class="context-group" data-context-group="${name}">([\\s\\S]*?)<\\/section>`))?.[1];
  assert.ok(group, `${name} 지식 연결 그룹이 생성된다`);
  return group;
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

test("지식 연결 모델은 직접 링크를 중복·자기참조 없이 역방향까지 계산한다", async () => {
  for (const page of result.wiki.pages) {
    const routes = page.outgoingPages.map((target) => target.route);
    assert.equal(new Set(routes).size, routes.length, `${page.relativePath}: 직접 연결 중복`);
    assert.ok(!page.outgoingPages.includes(page), `${page.relativePath}: 자기참조 제외`);
    for (const target of page.outgoingPages) {
      assert.ok(target.incomingPages.includes(page), `${page.relativePath} → ${target.relativePath}: 역연결`);
    }
    for (const reciprocal of page.reciprocalPages) {
      assert.ok(page.outgoingPages.includes(reciprocal), `${page.relativePath}: 상호 연결의 정방향`);
      assert.ok(page.incomingPages.includes(reciprocal), `${page.relativePath}: 상호 연결의 역방향`);
    }
  }
  const searchIndex = JSON.parse(await fs.readFile(path.join(outputDir, "search.json"), "utf8"));
  assert.ok(searchIndex.every((entry) => !Object.hasOwn(entry, "outgoingPages") && !Object.hasOwn(entry, "connectionCounts")), "검색 색인 구조를 유지한다");
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
    assert.match(html, /data-design="legal-editorial"/);
    assert.match(html, /<meta name="theme-color" content="#2547D0">/);
    if (page.route === "/") {
      const leadStart = html.indexOf('<section class="home-lead"');
      const searchStart = html.indexOf('<section class="home-search"');
      const lead = html.slice(leadStart, searchStart);
      const article = html.match(/<article class="prose home-description">([\s\S]*?)<\/article>/)?.[1];
      assert.ok(article, "홈 설명 본문");
      assert.ok(leadStart >= 0 && searchStart > leadStart, "홈 소개와 신뢰 현황은 검색보다 앞선 하나의 리드 영역에 있다");
      assert.match(lead, /class="page-hero is-home"/);
      assert.match(lead, /class="home-stats"/);
      assert.doesNotMatch(lead, /class="aliases"/);
      assert.doesNotMatch(lead, /class="page-facts evidence-strip"/);
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
      assert.match(html, /class="article-evidence-trust page-hero-trust"/);
      assert.doesNotMatch(html, /class="reading-rail"/);
    }
    assert.match(html, /<dialog[^>]+aria-labelledby="search-dialog-title"/);
    assert.match(html, /data-search-close aria-label="검색 닫기"/);
    assert.match(html, /class="search-filter-toggle"[^>]+data-search-filter-toggle[^>]+aria-expanded="false"[^>]+aria-controls="search-filter-sheet"/);
    assert.match(html, /data-search-filter-summary>0<\/strong>/);
    assert.match(html, /data-search-active-filters[^>]+hidden/);
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

test("문서 히어로는 신뢰정보와 의미 상태를 분리해 표시한다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  const legalStatusPage = result.wiki.pages.find((page) => page.data.legal_status);
  const html = await fs.readFile(outputPathForRoute(outputDir, legalStatusPage.route), "utf8");
  assert.match(html, /class="article-evidence-trust page-hero-trust"><dl class="page-facts evidence-strip"/);
  assert.match(html, /class="legal-status legal-status-[a-z]+ status-tone-(?:current|muted|warning)"/);
  assert.match(css, /\.page-hero-content\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(14rem, 18rem\);/);
  assert.match(css, /\.page-facts\.evidence-strip\s*\{[^}]*display:\s*grid;[^}]*border:\s*1px solid var\(--line\);/);
  assert.match(css, /\.status-tone-current[\s\S]*?color:\s*var\(--active\);/);
  assert.match(css, /\.status-tone-review[\s\S]*?color:\s*var\(--review\);/);
  assert.match(css, /\.status-tone-warning[\s\S]*?color:\s*var\(--danger\);/);
});

test("모바일 바로 찾기 홀수 격자는 빈 셀의 경계선을 닫는다", async () => {
  const homeHtml = await fs.readFile(outputPathForRoute(outputDir, "/"), "utf8");
  assert.match(homeHtml, /class="home-search-suggestions" data-has-empty-cell/);

  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  const mobileStart = css.indexOf("@media (max-width: 38rem)");
  const printStart = css.indexOf("@media print", mobileStart);
  assert.ok(mobileStart >= 0 && printStart > mobileStart, "38rem 모바일 스타일 구간");
  const mobileCss = css.slice(mobileStart, printStart);
  assert.match(mobileCss, /\.home-search-suggestions\[data-has-empty-cell\]::after\s*\{[^}]*content:\s*"";[^}]*border-top:\s*1px solid var\(--line\);[^}]*border-left:\s*1px solid var\(--line\);/);
});

test("모바일 근거 패널은 펼침 표시와 제목이 겹치지 않는다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  const mobileStart = css.indexOf("@media (max-width: 38rem)");
  const printStart = css.indexOf("@media print", mobileStart);
  assert.ok(mobileStart >= 0 && printStart > mobileStart, "38rem 모바일 스타일 구간");
  const mobileCss = css.slice(mobileStart, printStart);
  assert.match(mobileCss, /\.evidence-panel summary,\s*\.cited-by-panel summary\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;[^}]*padding:\s*0\.65rem 0\.75rem;/);
});

test("전역 탐색과 지식 문맥은 문서 단위 탐색을 분리한다", async () => {
  const documentPage = result.wiki.pages.find((page) => (
    page.category !== "meta"
    && page.category !== "sources"
    && page.connectionCounts.direct > 0
    && page.connectionCounts.incoming > 0
    && page.connectionCounts.evidence > 0
  ));
  assert.ok(documentPage, "직접·역·근거 연결을 모두 가진 문서가 있다");
  const html = await fs.readFile(outputPathForRoute(outputDir, documentPage.route), "utf8");

  const globalMenu = html.match(/<aside class="global-menu" id="sidebar"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
  assert.ok(globalMenu, "#sidebar.global-menu이 생성된다");
  assert.match(globalMenu, /class="global-menu-shortcuts"/);
  assert.match(globalMenu, /class="global-menu-groups"/);
  assert.doesNotMatch(html, /(?:class|data-[^=]+)="sidebar-pages(?:\s|")/);
  for (const category of Object.keys(result.wiki.groups)) {
    assert.match(globalMenu, new RegExp(`href="${basePath}${category}/"`), category);
  }

  const context = knowledgeContextMarkup(html);
  assert.match(context, /class="context-current"/);
  for (const [label, value] of [
    ["직접 연결", documentPage.connectionCounts.direct],
    ["역연결", documentPage.connectionCounts.incoming],
    ["근거", documentPage.connectionCounts.evidence]
  ]) {
    assert.match(context, new RegExp(`<dt>${label}<\\/dt><dd>${value}<\\/dd>`), label);
  }

  const toggleCount = documentPage.connectionCounts.direct
    + documentPage.connectionCounts.incoming
    + documentPage.connectionCounts.evidence
    + documentPage.connectionCounts.sourceLineage;
  assert.match(html, new RegExp(`class="context-trigger"[^>]*data-context-toggle[^>]*aria-controls="knowledge-context"[^>]*aria-expanded="false"[^>]*>[\\s\\S]*?<strong>${toggleCount}<\\/strong>`));
  assert.match(html, /class="menu-trigger"[^>]*data-menu-toggle[^>]*aria-controls="sidebar"/);
  assert.match(html, /class="menu-backdrop"[^>]*data-menu-close/);
  assert.match(html, /class="context-backdrop"[^>]*data-context-backdrop[^>]*data-context-close/);
  assert.match(html, /<details class="reading-menu">[\s\S]*?<section class="reader-settings"/);

  const sameAreaPage = result.wiki.pages.find((candidate) => candidate !== documentPage && candidate.data.legal_area === documentPage.data.legal_area);
  assert.ok(sameAreaPage, "같은 법률 영역 문서가 있다");
  const fallbackPage = {
    ...documentPage,
    outgoingPages: [],
    incomingPages: [],
    reciprocalPages: [],
    sourcePages: [],
    sameAreaPages: [sameAreaPage],
    connectionCounts: { ...documentPage.connectionCounts, direct: 0, incoming: 0, reciprocal: 0, evidence: 0 }
  };
  const fallbackHtml = renderPage({
    page: fallbackPage,
    rendered: { contentHtml: "<p>연결 패널 회귀 검사</p>", toc: [] },
    wiki: result.wiki,
    basePath,
    siteUrl: "https://example.test/LaborLaw_Wiki",
    repositoryUrl: "https://github.com/YgHnSIM/LaborLaw_Wiki",
    repositoryRef: "0123456789abcdef"
  });
  const fallbackContext = knowledgeContextMarkup(fallbackHtml);
  const sameAreaGroup = contextGroupMarkup(fallbackContext, "same-area");
  assert.match(sameAreaGroup, /같은 법률 영역/);
  assert.match(sameAreaGroup, /직접 연결이 없어 같은 영역 문서만 표시합니다./);
  assert.match(sameAreaGroup, new RegExp(`href="${siteHref(basePath, sameAreaPage.route)}"`));
  assert.doesNotMatch(context, /data-context-group="same-area"/, "직접 연결이 있으면 같은 영역 보완 목록을 숨긴다");
});

test("출처·홈·분류의 지식 문맥은 위키 연결 모델을 그대로 요약한다", async () => {
  const sourcePage = result.wiki.pages.find((page) => page.category === "sources" && page.citedBy.length > 0 && page.relatedSources.length > 0);
  assert.ok(sourcePage, "인용 및 관련 자료가 있는 출처가 있다");
  const sourceHtml = await fs.readFile(outputPathForRoute(outputDir, sourcePage.route), "utf8");
  const sourceContext = knowledgeContextMarkup(sourceHtml);
  for (const [label, value] of [
    ["근거 사용", sourcePage.citedBy.length],
    ["관련 자료", sourcePage.relatedSources.length],
    ["대체 자료", sourcePage.supersedingSource ? 1 : 0]
  ]) {
    assert.match(sourceContext, new RegExp(`<dt>${label}<\\/dt><dd>${value}<\\/dd>`), label);
  }
  const citedBy = contextGroupMarkup(sourceContext, "cited-by");
  const relatedSources = contextGroupMarkup(sourceContext, "related-sources");
  assert.match(citedBy, new RegExp(`data-context-count>${sourcePage.citedBy.length}<\\/span>`));
  assert.equal((citedBy.match(/class="context-link-title"/g) ?? []).length, sourcePage.citedBy.length);
  assert.match(relatedSources, new RegExp(`data-context-count>${sourcePage.relatedSources.length}<\\/span>`));
  assert.equal((relatedSources.match(/class="context-link-title"/g) ?? []).length, sourcePage.relatedSources.length);

  const homeHtml = await fs.readFile(outputPathForRoute(outputDir, "/"), "utf8");
  const homeContext = knowledgeContextMarkup(homeHtml);
  const contentPageCount = result.wiki.pages.filter((page) => page.category !== "meta").length;
  const connections = result.wiki.stats.connections;
  for (const [label, value] of [
    ["본문 연결 문서", `${connections.directConnectedPages}/${contentPageCount}`],
    ["직접 연결", connections.directLinks],
    ["근거 연결", connections.evidenceLinks],
    ["본문 링크 없음", connections.directIsolatedPages]
  ]) {
    assert.match(homeContext, new RegExp(`<dt>${label}<\\/dt><dd>${value}<\\/dd>`), label);
  }

  const category = "concepts";
  const categoryHtml = await fs.readFile(path.join(outputDir, category, "index.html"), "utf8");
  const categoryContext = knowledgeContextMarkup(categoryHtml);
  const categoryStats = connections.categories[category];
  for (const [label, value] of [
    ["문서", result.wiki.groups[category].length],
    ["직접 연결", categoryStats.directLinks],
    ["분류 간", categoryStats.crossCategoryLinks],
    ["본문 링크 없음", categoryStats.directIsolatedPages]
  ]) {
    assert.match(categoryContext, new RegExp(`<dt>${label}<\\/dt><dd>${value}<\\/dd>`), `${category} ${label}`);
  }
  assert.match(categoryHtml, /data-context-toggle[^>]*aria-controls="knowledge-context"/);
});

test("전역 메뉴와 지식 문맥은 별도 반응형 서랍으로 동작한다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  const mediumStart = css.indexOf("@media (max-width: 78rem)");
  const narrowStart = css.indexOf("@media (max-width: 58rem)", mediumStart);
  const compactStart = css.indexOf("@media (max-width: 38rem)", narrowStart);
  assert.ok(mediumStart >= 0 && narrowStart > mediumStart && compactStart > narrowStart, "탐색 서랍 반응형 스타일 구간");
  const mediumCss = css.slice(mediumStart, narrowStart);
  const narrowCss = css.slice(narrowStart, compactStart);
  assert.match(mediumCss, /\.global-menu\s*\{[^}]*display:\s*block;[^}]*transform:\s*translateX\(-105%\);/);
  assert.match(mediumCss, /\.menu-open \.global-menu\s*\{[^}]*transform:\s*translateX\(0\);/);
  assert.match(mediumCss, /\.menu-backdrop\s*\{[^}]*display:\s*block;/);
  assert.match(narrowCss, /\.knowledge-context\s*\{[^}]*border-left:\s*1px solid var\(--line-strong\);[^}]*transform:\s*translateX\(105%\);/);
  assert.match(narrowCss, /\.context-open \.knowledge-context\s*\{[^}]*transform:\s*translateX\(0\);/);
  assert.match(narrowCss, /\.context-backdrop\s*\{[^}]*display:\s*block;/);
  assert.match(narrowCss, /\.reading-menu \.reader-settings\s*\{[^}]*position:\s*fixed;/);

  const app = await fs.readFile(path.join(rootDir, "site", "assets", "app.js"), "utf8");
  assert.match(app, /function setupNavigationDrawers\(\)/);
  assert.match(app, /querySelectorAll\("\[data-menu-toggle\]"\)/);
  assert.match(app, /querySelectorAll\("\[data-menu-close\]"\)/);
  assert.match(app, /querySelectorAll\("\[data-context-toggle\]"\)/);
  assert.match(app, /querySelectorAll\("\[data-context-close\]"\)/);
  assert.match(app, /querySelectorAll\("\[data-context-backdrop\]"\)/);
  assert.match(app, /body\.classList\.toggle\("menu-open", menuOpen\)/);
  assert.match(app, /body\.classList\.toggle\("context-open", contextOpen\)/);
  assert.match(app, /if \(menuOpen\) contextOpen = false;/);
  assert.match(app, /if \(contextOpen\) menuOpen = false;/);
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
  assert.match(css, /\.reader-settings select,\s*\.category-controls select,\s*\.search-filters select\s*\{[^}]*font-family:\s*var\(--font-body\);/);
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
  assert.match(homeHtml, /class="search-active-filters" data-search-active-filters aria-label="적용 중인 검색 필터" hidden/);
  assert.match(homeHtml, /class="home-dashboard home-analysis-collection"/);
  assert.match(homeHtml, /class="home-collection-stack"/);

  const areaCounts = new Map();
  for (const page of result.wiki.pages) {
    if (!page.data.legal_area) continue;
    const count = areaCounts.get(page.data.legal_area) ?? { total: 0, active: 0, draft: 0, review: 0 };
    count.total += 1;
    count[page.data.status] = (count[page.data.status] ?? 0) + 1;
    areaCounts.set(page.data.legal_area, count);
  }
  for (const [area, count] of areaCounts) {
    const areaPattern = new RegExp(`data-search-preset-area="${area}"[\\s\\S]*?class="area-meter" aria-hidden="true" style="--area-total: ${count.total}; --area-active: ${count.active ?? 0}; --area-draft: ${count.draft ?? 0}; --area-review: ${count.review ?? 0};"[\\s\\S]*?<small>활성 ${count.active ?? 0} · 초안 ${count.draft ?? 0} · 검토 ${count.review ?? 0}<\\/small>`);
    assert.match(homeHtml, areaPattern);
  }

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
  assert.match(app, /data-search-active-filters/);
  assert.match(app, /renderActiveFilters/);
  assert.match(app, /search-filter-chip/);
  assert.match(app, /search-meta-category/);
  assert.match(app, /search-meta-status/);

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
  assert.match(css, /\.search-dialog\[open\]\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto auto auto auto minmax\(0, 1fr\);/);
  assert.match(css, /\.search-dialog\[open\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(css, /\.search-active-filters\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /\.search-filter-chip\s*\{[^}]*border-radius:\s*999px;/);
  assert.match(css, /\.area-meter\s*\{[^}]*display:\s*flex;/);
  assert.match(css, /\.area-meter-active[\s\S]*?flex-grow:\s*var\(--area-active, 0\);/);
  const mediumStart = css.indexOf("@media (max-width: 78rem)");
  const mobileStart = css.indexOf("@media (max-width: 58rem)");
  assert.ok(mediumStart >= 0 && mobileStart > mediumStart, "78rem 반응형 스타일 구간");
  const mediumCss = css.slice(mediumStart, mobileStart);
  assert.match(mediumCss, /\.home-lead,\s*\.home-collections\s*\{[^}]*grid-template-columns:\s*1fr;/);
  assert.match(mediumCss, /\.home-collection-stack\s*\{[^}]*grid-template-columns:\s*1fr;/);
  assert.match(mediumCss, /\.home-area-dashboard ul\s*\{[^}]*grid-template-columns:\s*1fr;/);
});

test("현대 법률 편집물 디자인 계약을 일관되게 사용한다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  const templates = await fs.readFile(path.join(rootDir, "site", "templates.mjs"), "utf8");
  const favicon = await fs.readFile(path.join(rootDir, "site", "assets", "favicon.svg"), "utf8");
  for (const token of [
    "--canvas: #f4f6f8;", "--surface: #ffffff;", "--ink: #111827;", "--ink-muted: #5f6b7a;",
    "--line: #d6dbe3;", "--line-strong: #273244;", "--brand: #2547d0;", "--brand-soft: #eef2ff;",
    "--active: #0f766e;", "--review: #b45309;", "--danger: #b42318;", "--archived: #64748b;"
  ]) assert.ok(css.includes(token), `디자인 토큰 누락: ${token}`);
  assert.match(templates, /data-design="legal-editorial"/);
  assert.match(css, /--font-display:\s*"MaruBuri"/);
  assert.match(css, /--font-body:\s*"RIDIBatang"/);
  assert.match(css, /--font-meta:\s*"D2Coding"/);
  assert.match(css, /@font-face[\s\S]*font-family:\s*"MaruBuri"/);
  assert.match(css, /@font-face[\s\S]*font-family:\s*"D2Coding"/);
  assert.match(css, /@font-face[\s\S]*font-family:\s*"RIDIBatang"/);
  assert.match(css, /\.page-hero h1,[\s\S]*?font-family:\s*var\(--font-display\);/);
  assert.match(css, /\.prose h2,[\s\S]*?font-family:\s*var\(--font-display\);/);
  assert.match(css, /--ease:\s*160ms ease;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /8px 8px 0/i);
  assert.doesNotMatch(css, /fonts\.(?:googleapis|gstatic)\.com/i);
  assert.match(favicon, /fill="#2547D0"/);
  assert.match(favicon, /stroke="#273244"/);
  const manifest = JSON.parse(await fs.readFile(path.join(outputDir, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.background_color, "#F4F6F8");
  assert.equal(manifest.theme_color, "#2547D0");
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
  const searchBudget = Math.max(600_000, expectedPageCount * 3_600);
  const fontSize = fontStats.reduce((total, stat) => total + stat.size, 0);
  const readingFontSize = fontSize + ridiFont.length;
  const headingFontSize = headingFontStats.reduce((total, stat) => total + stat.size, 0);
  assert.ok(cssSize < 80_000, `CSS ${cssSize} bytes`);
  assert.ok(javascriptSize < 40_000, `JavaScript 합계 ${javascriptSize} bytes`);
  assert.ok(searchSize < searchBudget, `검색 색인 ${searchSize}/${searchBudget} bytes`);
  assert.ok(readingFontSize < 3_200_000, `본문 글꼴 ${readingFontSize} bytes`);
  assert.ok(headingFontSize < 9_000_000, `제목 글꼴 ${headingFontSize} bytes`);
});
