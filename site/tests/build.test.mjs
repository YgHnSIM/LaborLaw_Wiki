import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSite } from "../build.mjs";
import { INSTRUCTION_FILENAMES, outputPathForRoute, siteHref } from "../lib/wiki.mjs";
import { createMarkdownRenderer, renderMarkdownPage } from "../lib/render-markdown.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const basePath = "/LaborLaw_Wiki/";
let outputDir;
let result;
let expectedPageCount;
let expectedWikiLinkCount;
let expectedCategoryCounts;
const RESEARCH_ISSUE_IDS = [
  "worker-employer",
  "wage-benefit",
  "working-time",
  "dismissal-personnel",
  "nonstandard-work",
  "collective-labor",
  "industrial-safety",
  "equality-remedy",
  "legislation-change"
];

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

const VOID_HTML_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"
]);

function directSearchDialogChildren(html) {
  const dialog = html.match(/<dialog\b(?=[^>]*\bid="search-dialog")[^>]*>/);
  assert.ok(dialog?.index !== undefined, "검색 대화상자가 생성된다");

  const tagPattern = /<\/?([A-Za-z][\w:-]*)(?:\s[^<>]*)?>/g;
  tagPattern.lastIndex = dialog.index + dialog[0].length;
  const children = [];
  let depth = 0;

  for (let match = tagPattern.exec(html); match; match = tagPattern.exec(html)) {
    const opening = !match[0].startsWith("</");
    const name = match[1].toLowerCase();
    if (!opening) {
      if (depth === 0 && name === "dialog") break;
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) children.push({ name, opening: match[0], start: match.index, end: tagPattern.lastIndex });
    if (!VOID_HTML_ELEMENTS.has(name) && !match[0].endsWith("/>")) depth += 1;
  }
  return children;
}

function attributeValue(openingTag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return openingTag.match(new RegExp(`\\b${escapedName}=(?:"([^"]*)"|'([^']*)')`))?.slice(1).find(Boolean) ?? null;
}

function researchMembershipShape(memberships) {
  return memberships.map(({ issue, stageIds }) => ({
    issueId: issue.id,
    stageIds: [...stageIds]
  }));
}

before(async () => {
  const wikiDir = path.join(rootDir, "wiki");
  const wikiFiles = (await listFiles(wikiDir)).filter((file) => file.endsWith(".md") && !INSTRUCTION_FILENAMES.has(path.basename(file)));
  expectedPageCount = wikiFiles.length;
  expectedWikiLinkCount = 0;
  expectedCategoryCounts = { concepts: 0, analyses: 0, entities: 0, cases: 0, sources: 0, meta: 0 };
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

test("연구 쟁점 모델은 등록부·단계·문서 귀속을 일관되게 해소한다", async () => {
  const { wiki } = result;
  const { researchIssues, researchIssueMemberships } = wiki;
  assert.ok(Array.isArray(researchIssues), "연구 쟁점 등록부가 배열로 제공된다");
  assert.ok(researchIssueMemberships instanceof Map, "문서별 연구 쟁점 귀속은 route Map으로 제공된다");
  assert.deepEqual(researchIssues.map((issue) => issue.id), RESEARCH_ISSUE_IDS, "9개 쟁점 등록부의 순서를 고정한다");

  const issueById = new Map(researchIssues.map((issue) => [issue.id, issue]));
  for (const issue of researchIssues) {
    assert.equal(typeof issue.question, "string", `${issue.id}: 연구 질문`);
    assert.ok(issue.question.trim(), `${issue.id}: 연구 질문이 비어 있지 않다`);
    assert.equal(typeof issue.description, "string", `${issue.id}: 연구 설명`);
    assert.ok(issue.description.trim(), `${issue.id}: 연구 설명이 비어 있지 않다`);
    assert.ok(Array.isArray(issue.stages) && issue.stages.length > 0, `${issue.id}: 연구 단계`);
    assert.ok(Array.isArray(issue.pages) && issue.pages.length > 0, `${issue.id}: 직접 구성 문서`);
    assert.equal(issue.documentCount, issue.pages.length, `${issue.id}: 문서 수`);
    assert.equal(issue.analysisCount, issue.pages.filter((page) => page.category === "analyses").length, `${issue.id}: 분석 문서 수`);
    assert.equal(issue.reviewCount, issue.pages.filter((page) => page.data.status === "review").length, `${issue.id}: 검토 문서 수`);
    assert.ok(issue.pages.includes(issue.primaryPage), `${issue.id}: 대표 문서는 구성 문서에 포함된다`);

    const routes = issue.pages.map((page) => page.route);
    assert.equal(new Set(routes).size, routes.length, `${issue.id}: 직접 구성 문서가 중복되지 않는다`);
    const officialSourceRoutes = new Set(issue.pages
      .flatMap((page) => page.sourcePages)
      .filter((source) => source.data.source_type.startsWith("official_"))
      .map((source) => source.route));
    assert.equal(issue.officialSourceCount, officialSourceRoutes.size, `${issue.id}: 고유 공식 근거 수`);

    const stageIds = new Set();
    const stagedRoutes = new Set();
    for (const stage of issue.stages) {
      assert.equal(typeof stage.id, "string", `${issue.id}: 단계 ID`);
      assert.ok(stage.id, `${issue.id}: 빈 단계 ID가 없다`);
      assert.ok(!stageIds.has(stage.id), `${issue.id}: 단계 ID가 중복되지 않는다`);
      stageIds.add(stage.id);
      assert.equal(typeof stage.label, "string", `${issue.id}/${stage.id}: 단계명`);
      assert.ok(stage.label.trim(), `${issue.id}/${stage.id}: 단계명이 비어 있지 않다`);
      assert.ok(Array.isArray(stage.pages), `${issue.id}/${stage.id}: 단계 문서 목록`);
      for (const page of stage.pages) {
        assert.ok(issue.pages.includes(page), `${issue.id}/${stage.id}: 단계 문서는 쟁점 구성 문서다`);
        assert.notEqual(page.category, "sources", `${issue.id}/${stage.id}: 출처는 직접 단계에 등록하지 않는다`);
        stagedRoutes.add(page.route);
      }
    }
    assert.deepEqual([...stagedRoutes].sort(), [...routes].sort(), `${issue.id}: 단계 문서의 합집합이 쟁점 문서와 같다`);
  }

  for (const page of wiki.pages) {
    const memberships = researchIssueMemberships.get(page.route) ?? [];
    assert.ok(Array.isArray(memberships), `${page.relativePath}: 연구 쟁점 귀속은 배열이다`);
    assert.deepEqual(page.researchIssueIds, memberships.map((membership) => membership.issue.id), `${page.relativePath}: 쟁점 ID 파생값`);
    assert.deepEqual(researchMembershipShape(page.researchIssueMemberships), researchMembershipShape(memberships), `${page.relativePath}: 쟁점 귀속 파생값`);

    let previousIssueIndex = -1;
    for (const membership of memberships) {
      const issue = issueById.get(membership.issue.id);
      assert.equal(membership.issue, issue, `${page.relativePath}: 등록부의 해소된 쟁점 객체를 사용한다`);
      const issueIndex = RESEARCH_ISSUE_IDS.indexOf(issue.id);
      assert.ok(issueIndex > previousIssueIndex, `${page.relativePath}: 쟁점 귀속은 등록부 순서다`);
      previousIssueIndex = issueIndex;
      assert.ok(Array.isArray(membership.stageIds) && membership.stageIds.length > 0, `${page.relativePath}/${issue.id}: 단계 귀속`);
      assert.equal(new Set(membership.stageIds).size, membership.stageIds.length, `${page.relativePath}/${issue.id}: 단계 귀속 중복`);
      for (const stageId of membership.stageIds) {
        const stage = issue.stages.find((candidate) => candidate.id === stageId);
        assert.ok(stage, `${page.relativePath}/${issue.id}: 등록된 단계만 참조한다`);
        if (page.category !== "sources") {
          assert.ok(stage.pages.includes(page), `${page.relativePath}/${issue.id}/${stageId}: 직접 구성 문서의 단계 역참조`);
        }
      }
    }
  }

  for (const source of wiki.groups.sources) {
    const expectedStageIdsByIssue = new Map();
    for (const citedBy of source.citedBy) {
      for (const membership of researchIssueMemberships.get(citedBy.route) ?? []) {
        const stageIds = expectedStageIdsByIssue.get(membership.issue.id) ?? new Set();
        membership.stageIds.forEach((stageId) => stageIds.add(stageId));
        expectedStageIdsByIssue.set(membership.issue.id, stageIds);
      }
    }
    const expected = researchIssues
      .filter((issue) => expectedStageIdsByIssue.has(issue.id))
      .map((issue) => ({
        issueId: issue.id,
        stageIds: issue.stages
          .filter((stage) => expectedStageIdsByIssue.get(issue.id).has(stage.id))
          .map((stage) => stage.id)
      }));
    const actual = researchMembershipShape(researchIssueMemberships.get(source.route) ?? []);
    assert.deepEqual(actual, expected, `${source.relativePath}: 출처 귀속은 인용 문서의 쟁점·단계 합집합이다`);
  }

  for (const page of wiki.pages) {
    for (const field of ["outgoingPages", "incomingPages", "reciprocalPages", "sameAreaPages", "connectionCounts"]) {
      assert.equal(Object.hasOwn(page, field), false, `${page.relativePath}: 기존 직접 연결 필드 ${field}를 노출하지 않는다`);
    }
  }
  assert.equal(Object.hasOwn(wiki.stats, "connections"), false, "기존 직접 연결 통계를 노출하지 않는다");

  const searchIndex = JSON.parse(await fs.readFile(path.join(outputDir, "search.json"), "utf8"));
  assert.ok(searchIndex.every((entry) => [
    "outgoingPages",
    "connectionCounts",
    "researchIssues",
    "researchIssueIds",
    "researchIssueMemberships"
  ].every((field) => !Object.hasOwn(entry, field))), "검색 색인 구조에 연결·연구 데스크 내부 필드를 추가하지 않는다");
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
    assert.match(html, /<div class="page-frame">/);
    assert.doesNotMatch(html, /class="page-frame page-frame-wide"/);
    assert.doesNotMatch(html, /class="[^"]*\b(?:nav-number|category-number|page-folio|dialog-number|record-number|card-index)\b[^"]*"/);
    assert.doesNotMatch(html, /class="page-summary"/);
    assert.doesNotMatch(html, /(?:data-research-context|data-context-toggle|id="knowledge-context"|class="context-trigger")/);
    if (page.route === "/") {
      const workbenchStart = html.indexOf('class="research-workbench"');
      const article = html.match(/<article class="prose home-description">([\s\S]*?)<\/article>/)?.[1];
      assert.ok(article, "홈 설명 본문");
      assert.ok(workbenchStart >= 0, "홈은 리서치 워크벤치로 시작한다");
      assert.match(html, /class="research-workbench-head"/);
      assert.match(html, /class="research-workbench-copy"/);
      assert.match(html, /class="research-search"/);
      assert.match(html, /class="research-meta"/);
      assert.match(html, /class="research-desk"/);
      assert.doesNotMatch(html, /class="research-intro"/);
      assert.doesNotMatch(html, /class="research-trust-ribbon"/);
      assert.doesNotMatch(html, /class="research-queue"/);
      assert.match(html, /<details class="home-about">/);
      assert.match(article, /<h2[^>]*>기준일과 현재 상태/);
      assert.doesNotMatch(html, /class="breadcrumbs"/);
      assert.doesNotMatch(html, /class="page-toc"/);
      assert.doesNotMatch(html, /class="mobile-toc"/);
      assert.doesNotMatch(html, /data-research-context/);
    } else if (page.route === "/catalog/") {
      assert.match(html, /class="main-content main-content--category category-main catalog-main"/);
      assert.match(html, /class="category-shell"/);
      assert.match(html, /<header class="category-hero">/);
      assert.match(html, /data-catalog-filters/);
      assert.match(html, /class="catalog-group-head"/);
      assert.doesNotMatch(html, /class="document-shell"/);
      assert.doesNotMatch(html, /<header class="article-hero">/);
      assert.doesNotMatch(html, /class="document-compact-meta"/);
      assert.doesNotMatch(html, /class="page-toc"/);
      assert.doesNotMatch(html, /class="mobile-toc"/);
      assert.doesNotMatch(html, /<aside class="document-rail"/);
    } else {
      assert.match(html, /class="main-content main-content--document"/);
      assert.match(html, /class="document-shell"/);
      assert.match(html, /<header class="article-hero">/);
      assert.match(html, /class="document-compact-meta"/);
      assert.match(html, /class="page-toc"/);
      assert.match(html, /class="mobile-toc"/);
      assert.match(html, /<aside class="document-rail"/);
      assert.match(html, /class="article-evidence-trust"><dl class="page-facts evidence-strip"/);
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

test("전체 색인은 기존 섹션 링크를 보존한 분류형 카탈로그로 생성한다", async () => {
  const catalogPage = result.wiki.pages.find((page) => page.route === "/catalog/");
  const html = await fs.readFile(outputPathForRoute(outputDir, catalogPage.route), "utf8");
  const expectedLinks = result.wiki.pages
    .filter((page) => page.route !== "/catalog/")
    .map((page) => siteHref(basePath, page.route))
    .sort();
  const catalogLinks = [...html.matchAll(/data-catalog-card[\s\S]*?<a href="([^"]+)"/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(catalogLinks, expectedLinks);
  assert.equal(new Set(catalogLinks).size, catalogLinks.length, "각 문서는 색인에 한 번만 출력된다");
  assert.equal((html.match(/data-catalog-group(?:\s|=|>)/g) ?? []).length, 7);
  for (const anchor of ["홈", "메타", "소스", "개념", "개체", "분석", "사건", "관련-항목"]) {
    assert.match(html, new RegExp(`id="${anchor}"`), anchor);
  }
  assert.match(html, /data-catalog-category/);
  assert.match(html, /data-catalog-status/);
  assert.match(html, /data-catalog-area/);
  assert.match(html, /data-catalog-count/);
  assert.match(html, /<h3>/);
  assert.match(html, /class="document-category"/);
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

  const locatorPage = result.wiki.pages.find((item) => item.data.title === "연차휴가수당");
  const locatorHtml = await fs.readFile(outputPathForRoute(outputDir, locatorPage.route), "utf8");
  assert.match(locatorHtml, /href="#evidence-SRC-ANNUAL-PAID-2026-PARK"/);
  assert.doesNotMatch(locatorHtml, /\[@SRC-ANNUAL-PAID-2026-PARK#p=44\]/);
  assert.equal((locatorHtml.match(/href="#evidence-SRC-D3A0A79006"/g) ?? []).length, 2);
  assert.equal((locatorHtml.match(/href="#evidence-SRC-ANNUAL-RIGHTS-2021-OH"/g) ?? []).length, 1);

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
  assert.equal(relative.some((file) => INSTRUCTION_FILENAMES.has(path.basename(file))), false);
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

test("문서 레일은 신뢰정보와 의미 상태를 본문에서 분리해 표시한다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  const legalStatusPage = result.wiki.pages.find((page) => page.data.legal_status);
  const html = await fs.readFile(outputPathForRoute(outputDir, legalStatusPage.route), "utf8");
  const documentRailStart = html.indexOf('class="document-rail"');
  const articleStart = html.indexOf('<article class="prose"');
  assert.ok(articleStart >= 0 && documentRailStart > articleStart, "본문 뒤에 독립 문서 레일이 생성된다");
  const trustStart = html.indexOf('class="article-evidence-trust"', documentRailStart);
  assert.ok(trustStart > documentRailStart, "신뢰 정보는 문서 레일 안에 있다");
  assert.match(html, /class="article-evidence-trust"><dl class="page-facts evidence-strip"/);
  assert.match(html, /class="legal-status legal-status-[a-z]+ status-tone-(?:current|muted|warning)"/);
  assert.match(css, /\.page-facts\.evidence-strip\s*\{[^}]*display:\s*grid;[^}]*border:\s*1px solid var\(--line\);/);
  assert.match(css, /\.status-tone-current[\s\S]*?color:\s*var\(--active\);/);
  assert.match(css, /\.status-tone-review[\s\S]*?color:\s*var\(--review\);/);
  assert.match(css, /\.status-tone-warning[\s\S]*?color:\s*var\(--danger\);/);
  const reviewPage = result.wiki.pages.find((page) => page.route !== "/" && page.data.status === "review");
  const reviewHtml = await fs.readFile(outputPathForRoute(outputDir, reviewPage.route), "utf8");
  const heroStart = reviewHtml.indexOf('<header class="article-hero">');
  const heroEnd = reviewHtml.indexOf("</header>", heroStart);
  const heroHtml = reviewHtml.slice(heroStart, heroEnd);
  assert.ok(heroStart >= 0 && heroEnd > heroStart, "문서 히어로가 생성된다");
  assert.match(heroHtml, /class="article-hero-meta document-status-row"/);
  assert.match(heroHtml, /class="status-notice[^\"]*"/);
  assert.doesNotMatch(heroHtml, /page-facts evidence-strip/, "상세 신뢰정보는 히어로가 아니라 문서 레일에 둔다");
  assert.equal((reviewHtml.match(/class="[^\"]*\bstatus-notice\b[^\"]*"/g) ?? []).length, 1, "상태 알림은 히어로에 한 번만 둔다");
  assert.match(css, /\.article-hero::before\s*\{[^}]*background:\s*var\(--brand\);/);
});

test("홈의 리서치 검색은 기존 검색 프리셋으로 바로 찾기를 제공한다", async () => {
  const homeHtml = await fs.readFile(outputPathForRoute(outputDir, "/"), "utf8");
  assert.match(homeHtml, /class="research-search-suggestions"/);
  for (const query of ["통상임금", "해고", "근로시간", "산업재해", "원하청 교섭"]) {
    assert.match(homeHtml, new RegExp(`data-search-open data-search-preset-query="${query}"`), query);
  }
});

test("모바일 근거 패널은 펼침 표시와 제목이 겹치지 않는다", async () => {
  const css = await fs.readFile(path.join(rootDir, "site", "assets", "styles.css"), "utf8");
  const mobileStart = css.indexOf("@media (max-width: 38rem)");
  const printStart = css.indexOf("@media print", mobileStart);
  assert.ok(mobileStart >= 0 && printStart > mobileStart, "38rem 모바일 스타일 구간");
  const mobileCss = css.slice(mobileStart, printStart);
  assert.match(mobileCss, /\.evidence-panel summary,\s*\.cited-by-panel summary\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;[^}]*padding:\s*0\.65rem 0\.75rem;/);
});

test("연구 데스크는 전역 탐색과 본문·근거 레일을 분리한다", async () => {
  const documentPage = result.wiki.pages.find((page) => (
    page.category !== "meta"
    && page.category !== "sources"
    && page.sourcePages.length > 0
    && page.researchIssueMemberships.length > 0
  ));
  assert.ok(documentPage, "근거와 연구 쟁점 귀속을 함께 가진 문서가 있다");
  const html = await fs.readFile(outputPathForRoute(outputDir, documentPage.route), "utf8");

  const globalMenu = html.match(/<aside class="global-menu" id="sidebar"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
  assert.ok(globalMenu, "#sidebar.global-menu이 생성된다");
  assert.match(globalMenu, /class="global-menu-shortcuts"/);
  assert.match(globalMenu, /class="global-menu-groups"/);
  assert.doesNotMatch(html, /(?:class|data-[^=]+)="sidebar-pages(?:\s|")/);
  for (const category of Object.keys(result.wiki.groups)) {
    assert.match(globalMenu, new RegExp(`href="${basePath}${category}/"`), category);
  }

  assert.doesNotMatch(html, /(?:data-research-context|data-context-toggle|id="knowledge-context"|class="context-trigger")/);
  assert.match(html, /class="menu-trigger"[^>]*data-menu-toggle[^>]*aria-controls="sidebar"/);
  assert.match(html, /class="menu-backdrop"[^>]*data-menu-close/);
  assert.match(html, /<details class="reading-menu">[\s\S]*?<section class="reader-settings"/);

  assert.match(html, /<article class="[^"]*\bprose\b[^"]*"[^>]*data-reading-article/);
  const documentRailStart = html.indexOf('class="document-rail"');
  const articleStart = html.indexOf('<article class="prose"');
  assert.ok(documentRailStart >= 0, "문서 우측 레일이 생성된다");
  assert.ok(articleStart >= 0 && documentRailStart > articleStart, "문서 레일은 본문과 분리된 뒤쪽 열에 생성된다");
  assert.ok(html.indexOf('class="article-evidence-trust"', documentRailStart) > documentRailStart, "신뢰 정보는 문서 레일에 들어간다");
  assert.ok(html.indexOf('class="page-toc"', documentRailStart) > documentRailStart, "데스크톱 목차는 문서 레일에 들어간다");
  assert.ok(html.indexOf('class="evidence-panel"', articleStart) > articleStart, "근거 상세와 인용 앵커는 본문 뒤에서도 유지된다");
  assert.match(html, /<details class="mobile-toc" data-mobile-toc>/);
  assert.match(html, /data-toc-link/);
});

test("홈은 연구 데스크를 유지하고 문서·분류의 쟁점 패널은 출력하지 않는다", async () => {
  const homeHtml = await fs.readFile(outputPathForRoute(outputDir, "/"), "utf8");
  assert.match(homeHtml, /class="[^"]*\bresearch-workbench\b[^"]*"/);
  assert.match(homeHtml, /data-issue-tabs/);
  const desktopIssueTabs = [...homeHtml.matchAll(/<button\b[^>]*\bdata-issue-select(?:\s|=|>)[^>]*>/g)].map((match) => match[0]);
  const issuePanels = [...homeHtml.matchAll(/<section\b[^>]*\bdata-issue-panel\b[^>]*>/g)].map((match) => match[0]);
  assert.equal(desktopIssueTabs.length, result.wiki.researchIssues.length, "데스크톱 쟁점 탭 수는 등록부 수와 같다");
  assert.equal(issuePanels.length, result.wiki.researchIssues.length, "홈 패널 수는 쟁점 등록부 수와 같다");
  for (const [index, issue] of result.wiki.researchIssues.entries()) {
    const tab = desktopIssueTabs.find((opening) => attributeValue(opening, "data-issue-id") === issue.id);
    const panel = issuePanels.find((opening) => attributeValue(opening, "data-issue-id") === issue.id);
    assert.ok(tab, `${issue.id}: 데스크톱 탭`);
    assert.ok(panel, `${issue.id}: 조사 패널`);
    assert.equal(attributeValue(tab, "id"), `issue-tab-${issue.id}`, `${issue.id}: 탭 ID`);
    assert.equal(attributeValue(tab, "aria-controls"), `issue-${issue.id}`, `${issue.id}: 탭-패널 연결`);
    assert.equal(attributeValue(panel, "id"), `issue-${issue.id}`, `${issue.id}: 패널 ID`);
    assert.equal(attributeValue(panel, "aria-labelledby"), `issue-tab-${issue.id}`, `${issue.id}: 패널-탭 연결`);
    assert.equal(/\bhidden\b/.test(panel), index !== 0, `${issue.id}: 기본 패널만 노출`);
  }

  const mobileIssueSelects = [...homeHtml.matchAll(/<select\b[^>]*\bdata-issue-select-mobile\b[^>]*>([\s\S]*?)<\/select>/g)];
  assert.equal(mobileIssueSelects.length, 1, "모바일에는 쟁점을 바꾸는 native select가 하나 있다");
  assert.match(mobileIssueSelects[0][0], /\baria-labelledby="research-issue-label"/);
  const mobileIssueIds = [...mobileIssueSelects[0][1].matchAll(/<option\b[^>]*\bvalue="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  assert.deepEqual(mobileIssueIds, result.wiki.researchIssues.map((issue) => issue.id), "모바일 select는 안정적인 쟁점 ID를 option 값으로 쓴다");
  assert.equal(
    (homeHtml.match(/\bdata-issue-stage\b/g) ?? []).length,
    result.wiki.researchIssues.reduce((sum, issue) => sum + issue.stages.length, 0),
    "홈은 각 쟁점의 연구 단계를 모두 노출한다"
  );
  assert.match(homeHtml, /class="[^"]*\bhome-about\b[^"]*"/);
  assert.doesNotMatch(homeHtml, /class="research-queue"/);
  assert.doesNotMatch(homeHtml, /(?:data-home-queue-select|data-home-queue-panel)/);
  assert.doesNotMatch(homeHtml, /data-context-toggle/, "홈은 별도 문맥 서랍 토글을 두지 않는다");
  assert.doesNotMatch(homeHtml, /data-research-context/, "홈은 별도 연구 문맥 서랍 대신 리서치 데스크를 사용한다");

  const documentPage = result.wiki.pages.find((page) => page.category === "concepts" && page.researchIssueMemberships.length > 0);
  assert.ok(documentPage, "연구 쟁점 귀속을 가진 개념 문서가 있다");
  const documentHtml = await fs.readFile(outputPathForRoute(outputDir, documentPage.route), "utf8");
  assert.doesNotMatch(documentHtml, /(?:data-context-toggle|data-research-context|id="knowledge-context")/);

  const categoryHtml = await fs.readFile(path.join(outputDir, "concepts", "index.html"), "utf8");
  assert.doesNotMatch(categoryHtml, /(?:data-context-toggle|data-research-context|id="knowledge-context")/);
});

test("홈페이지가 최근 추가 문서 3개를 표시한다", async () => {
  const homeHtml = await fs.readFile(outputPathForRoute(outputDir, "/"), "utf8");
  const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
  const expectedRecent = result.wiki.pages
    .filter((page) => page.category !== "meta")
    .sort((left, right) => (
      String(right.data.created).localeCompare(String(left.data.created))
      || String(right.data.updated).localeCompare(String(left.data.updated))
      || collator.compare(left.data.title, right.data.title)
    ))
    .slice(0, 3);
  const cards = [...homeHtml.matchAll(/<li\b[^>]*\bdata-recent-document\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1]);

  assert.match(homeHtml, /<h2 id="recent-documents-title">최근 추가된 문서<\/h2>/);
  assert.equal(cards.length, 3, "최근 추가 문서 카드는 정확히 3개다");
  assert.deepEqual(
    cards.map((card) => card.match(/<h2>([^<]+)<\/h2>/)?.[1]),
    expectedRecent.map((page) => page.data.title),
    "카드는 생성일·수정일·제목 순으로 정렬된다"
  );
  for (const [index, page] of expectedRecent.entries()) {
    assert.ok(cards[index].includes(`추가 ${page.data.created.replaceAll("-", ".")}`), `${page.data.title}: 생성일 표시`);
  }
});

test("전역 메뉴는 반응형 서랍으로 동작한다", async () => {
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
  assert.match(narrowCss, /\.reading-menu \.reader-settings\s*\{[^}]*position:\s*fixed;/);
  const app = await fs.readFile(path.join(rootDir, "site", "assets", "app.js"), "utf8");
  assert.match(app, /function setupNavigationDrawers\(\)/);
  assert.match(app, /querySelectorAll\("\[data-menu-toggle\]"\)/);
  assert.match(app, /querySelectorAll\("\[data-menu-close\]"\)/);
  assert.match(app, /body\.classList\.toggle\("menu-open", menuOpen\)/);
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
  assert.match(homeHtml, /class="research-workbench"/);
  assert.match(homeHtml, /class="research-meta"/);
  assert.doesNotMatch(homeHtml, /class="research-trust-ribbon"/);
  assert.match(homeHtml, new RegExp(`data-search-preset-status="review"><strong>${result.wiki.stats.statuses.review ?? 0}<\\/strong>개`));
  assert.match(homeHtml, new RegExp(`기준일 커버리지`));
  assert.match(homeHtml, new RegExp(`<time datetime="${result.wiki.stats.latestChecked}">`));
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
  const searchChildren = directSearchDialogChildren(homeHtml);
  assert.equal(searchChildren.length, 5, "검색 대화상자는 머리말·입력·명령·제어·결과의 다섯 직접 영역만 둔다");
  const [searchHead, searchField, searchCommand, searchControls, searchResults] = searchChildren;
  assert.deepEqual(searchChildren.map((child) => child.name), ["div", "label", "div", "div", "div"]);
  assert.match(searchHead.opening, /class="search-head"/);
  assert.match(searchField.opening, /class="search-field"/);
  assert.match(searchCommand.opening, /class="search-command-bar"/);
  assert.match(searchControls.opening, /class="search-controls-region"/);
  assert.match(searchControls.opening, /\bdata-search-controls\b/);
  assert.match(searchResults.opening, /class="search-results"/);
  assert.match(searchResults.opening, /\bdata-search-results\b/);
  const searchControlsMarkup = homeHtml.slice(searchControls.start, searchResults.start);
  assert.match(searchControlsMarkup, /data-search-active-filters/);
  assert.match(searchControlsMarkup, /data-search-filter-panel/);
  assert.match(searchControlsMarkup, /data-search-status-text/);
  assert.doesNotMatch(homeHtml, /(?:class="research-queue"|data-home-queue-select|data-home-queue-panel)/);

  const categoryHtml = await fs.readFile(path.join(outputDir, "concepts", "index.html"), "utf8");
  assert.match(categoryHtml, /data-category-filters/);
  assert.match(categoryHtml, /data-document-card data-status="draft"/);

  const catalogHtml = await fs.readFile(outputPathForRoute(outputDir, "/catalog/"), "utf8");
  assert.match(catalogHtml, /data-catalog-filters/);
  assert.match(catalogHtml, /data-catalog-card data-category="home"/);
  assert.match(catalogHtml, /data-catalog-group data-catalog-group-category="sources"/);

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
  assert.match(app, /function setupCatalogFilters\(\)/);
  assert.match(app, /data-catalog-category/);
  assert.match(app, /catalog-category/);
  assert.match(app, /function setupResearchDesk\(\)/);
  assert.match(app, /tabSelector: "\[data-issue-select\]"/);
  assert.match(app, /panelSelector: "\[data-issue-panel\]"/);
  assert.match(app, /nativeSelectSelector: "\[data-issue-select-mobile\], \[data-issue-native-select\]"/);
  assert.match(app, /nativeSelects\.forEach\(\(control\) => control\.addEventListener\("change"/);
  assert.match(app, /const keys = \["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"\];/);
  assert.match(app, /window\.addEventListener\("hashchange", \(\) => controls\.selectFromHash\(\)\)/);
  assert.match(app, /window\.addEventListener\("popstate", \(\) => controls\.selectFromHash\(\)\)/);

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
  assert.match(css, /\.research-dossier-panel\[hidden\][\s\S]*?display:\s*none\s*!important;/);
  assert.match(css, /\.research-question-index button\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /\.research-question-index button strong\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/);
  const mediumStart = css.indexOf("@media (max-width: 78rem)");
  const mobileStart = css.indexOf("@media (max-width: 58rem)");
  assert.ok(mediumStart >= 0 && mobileStart > mediumStart, "78rem 반응형 스타일 구간");
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
  assert.match(css, /\.article-hero h1\s*\{[^}]*font-family:\s*var\(--font-display\);/);
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
  assert.ok(cssSize < 96_000, `CSS ${cssSize} bytes`);
  assert.ok(javascriptSize < 40_000, `JavaScript 합계 ${javascriptSize} bytes`);
  assert.ok(searchSize < searchBudget, `검색 색인 ${searchSize}/${searchBudget} bytes`);
  assert.ok(readingFontSize < 3_200_000, `본문 글꼴 ${readingFontSize} bytes`);
  assert.ok(headingFontSize < 9_000_000, `제목 글꼴 ${headingFontSize} bytes`);
});
