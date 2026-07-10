import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSite } from "../build.mjs";
import { outputPathForRoute } from "../lib/wiki.mjs";
import { createMarkdownRenderer } from "../lib/render-markdown.mjs";

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
    expectedWikiLinkCount += (markdown.match(/\[\[[^\]]+\]\]/g) ?? []).length;
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
    assert.match(html, /class="page-toc"/);
    assert.match(html, /<dialog[^>]+aria-labelledby="search-dialog-title"/);
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
  assert.match(userHtml, new RegExp(`<span>근거 자료</span><strong>${userPage.sourcePages.length}</strong>`));
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

  const law = index.find((entry) => entry.sourceId === "SRC-D3A0A79006");
  assert.equal(law.publisher, "국가법령정보센터");
  assert.match(law.url, /^\/LaborLaw_Wiki\/sources\/src-d3a0a79006\/$/);

  assert.ok(index.some((entry) => `${entry.title} ${entry.metadata} ${entry.body}`.includes("2020다247190")));
  assert.ok(index.some((entry) => entry.metadata.includes("90퍼센트")));
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
  assert.match(css, /\.page-facts > span:last-child\s*\{[^}]*border-right: 1px solid var\(--line-strong\);/);
  assert.match(css, /\.page-facts\s*\{\s*display: inline-grid;\s*grid-template-columns: repeat\(2, max-content\);/);
  assert.match(css, /\.page-facts > span:nth-child\(even\)\s*\{[^}]*border-right: 1px solid var\(--line-strong\);/);
});
