import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  encodeRoute,
  loadWiki,
  normalizeBasePath,
  outputPathForRoute,
  siteHref,
  sourceTypeLabel,
  statusLabel
} from "./lib/wiki.mjs";
import { createMarkdownRenderer, renderMarkdownPage } from "./lib/render-markdown.mjs";
import { renderCategoryPage, renderNotFound, renderPage } from "./templates.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(moduleDir, "..");

function ensureSafeOutput(rootDir, outputDir) {
  const root = path.resolve(rootDir);
  const output = path.resolve(outputDir);
  const rootPrefix = `${root}${path.sep}`;
  const outputPrefix = `${output}${path.sep}`;
  if (output === root || root.startsWith(outputPrefix)) {
    throw new Error(`안전하지 않은 출력 경로입니다: ${output}`);
  }
  if (output.startsWith(rootPrefix) && !["_site", "dist"].includes(path.basename(output))) {
    throw new Error(`저장소 내부 출력 경로는 _site 또는 dist여야 합니다: ${output}`);
  }
}

async function writeFileEnsured(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function copyDirectory(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else if (entry.isFile()) await fs.copyFile(from, to);
  }));
}

function searchMetadata(page) {
  const data = page.data;
  const caseNumbers = data.case_decisions.map((entry) => entry.case_number).filter(Boolean);
  return [
    page.stem,
    data.source_id,
    data.publisher,
    data.source_type,
    sourceTypeLabel(data.source_type),
    data.legal_area,
    data.authority,
    data.legal_status,
    data.version,
    data.law_number,
    ...data.tags,
    ...data.bill_numbers,
    ...caseNumbers
  ].filter(Boolean).join(" ");
}

function buildSearchIndex(wiki, basePath) {
  return wiki.pages.map((page) => ({
    title: page.data.title,
    aliases: page.data.aliases,
    category: page.category,
    categoryLabel: CATEGORY_META[page.category].shortLabel,
    status: page.data.status,
    statusLabel: statusLabel(page.data.status),
    updated: page.data.updated,
    url: siteHref(basePath, page.route),
    excerpt: page.excerpt,
    sourceId: page.data.source_id || "",
    publisher: page.data.publisher || "",
    metadata: searchMetadata(page),
    body: ["index.md", "log.md"].includes(page.relativePath)
      ? ""
      : page.route === "/"
        ? page.excerpt
        : page.searchText
  }));
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absoluteRoute(siteUrl, route) {
  const base = String(siteUrl).replace(/\/$/, "");
  const encoded = encodeRoute(route);
  return route === "/" ? `${base}/` : `${base}${encoded}`;
}

function renderSitemap(wiki, siteUrl) {
  const categoryRoutes = CATEGORY_ORDER.map((category) => ({ route: `/${category}/`, updated: wiki.stats.latestUpdated }));
  const routes = [
    ...categoryRoutes,
    ...wiki.pages.map((page) => ({ route: page.route, updated: page.data.updated }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map(({ route, updated }) => `  <url><loc>${xmlEscape(absoluteRoute(siteUrl, route))}</loc>${updated ? `<lastmod>${xmlEscape(updated)}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
}

function renderManifest(basePath) {
  return JSON.stringify({
    name: "대한민국 노동법 위키",
    short_name: "노동법 위키",
    description: "법령·판례·행정자료의 근거를 추적하는 대한민국 노동법 지식베이스",
    lang: "ko-KR",
    start_url: siteHref(basePath, "/"),
    scope: normalizeBasePath(basePath),
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#002FA7",
    icons: [{ src: siteHref(basePath, "/assets/favicon.svg"), sizes: "any", type: "image/svg+xml" }]
  }, null, 2);
}

export async function buildSite(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? defaultRoot);
  const outputDir = path.resolve(options.outputDir ?? path.join(rootDir, "_site"));
  const basePath = normalizeBasePath(options.basePath ?? process.env.SITE_BASE ?? "/");
  const repositoryUrl = String(options.repositoryUrl ?? process.env.REPOSITORY_URL ?? "https://github.com/YgHnSIM/LaborLaw_Wiki").replace(/\/$/, "");
  const repositoryRef = String(options.repositoryRef ?? process.env.REPOSITORY_REF ?? "main");
  const siteUrl = String(options.siteUrl ?? process.env.SITE_URL ?? "http://localhost:4173").replace(/\/$/, "");

  ensureSafeOutput(rootDir, outputDir);
  const wiki = await loadWiki(rootDir);
  const markdown = createMarkdownRenderer({ lookup: wiki.lookup, basePath });
  const renderedPages = wiki.pages.map((page) => ({ page, rendered: renderMarkdownPage(markdown, page) }));
  const renderedWikiLinks = wiki.pages.reduce((sum, page) => sum + page.wikiLinks.length, 0);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await copyDirectory(path.join(rootDir, "site", "assets"), path.join(outputDir, "assets"));

  await Promise.all(renderedPages.map(async ({ page, rendered }) => {
    const html = renderPage({ page, rendered, wiki, basePath, siteUrl, repositoryUrl, repositoryRef });
    if (/\[\[[^\]]+\]\]/.test(html)) throw new Error(`${page.relativePath}: 렌더링 후 위키링크가 남았습니다.`);
    if (/<blockquote[^>]*>\s*<p>\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(html)) {
      throw new Error(`${page.relativePath}: 렌더링 후 콜아웃 표식이 남았습니다.`);
    }
    await writeFileEnsured(outputPathForRoute(outputDir, page.route), html);
  }));

  await Promise.all(CATEGORY_ORDER.map(async (category) => {
    const html = renderCategoryPage({ category, wiki, basePath, siteUrl, repositoryUrl });
    await writeFileEnsured(outputPathForRoute(outputDir, `/${category}/`), html);
  }));

  const searchIndex = buildSearchIndex(wiki, basePath);
  const auxiliaryWrites = [
    writeFileEnsured(path.join(outputDir, "404.html"), renderNotFound({ wiki, basePath, siteUrl, repositoryUrl })),
    writeFileEnsured(path.join(outputDir, "search.json"), `${JSON.stringify(searchIndex)}\n`),
    writeFileEnsured(path.join(outputDir, "manifest.webmanifest"), `${renderManifest(basePath)}\n`),
    writeFileEnsured(path.join(outputDir, "sitemap.xml"), renderSitemap(wiki, siteUrl)),
    writeFileEnsured(path.join(outputDir, ".nojekyll"), "")
  ];
  if (basePath === "/") {
    auxiliaryWrites.push(writeFileEnsured(
      path.join(outputDir, "robots.txt"),
      `User-agent: *\nAllow: /\nSitemap: ${absoluteRoute(siteUrl, "/sitemap.xml")}\n`
    ));
  }
  await Promise.all(auxiliaryWrites);

  return {
    rootDir,
    outputDir,
    basePath,
    siteUrl,
    wiki,
    pageCount: wiki.pages.length,
    categoryCount: CATEGORY_ORDER.length,
    wikiLinkCount: renderedWikiLinks,
    searchCount: searchIndex.length
  };
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  try {
    const result = await buildSite();
    process.stdout.write(`사이트 빌드 완료: 문서 ${result.pageCount}개, 위키링크 ${result.wikiLinkCount}개, 출력 ${result.outputDir}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
