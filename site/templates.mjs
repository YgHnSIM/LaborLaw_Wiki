import path from "node:path";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  encodeRoute,
  siteHref,
  sourceTypeLabel,
  statusLabel
} from "./lib/wiki.mjs";

const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function svgIcon(name) {
  const paths = {
    search: '<circle cx="11" cy="11" r="6.75"></circle><path d="m16 16 4.25 4.25"></path>',
    menu: '<path d="M3 6.5h18M3 12h18M3 17.5h18"></path>',
    close: '<path d="m5 5 14 14M19 5 5 19"></path>',
    external: '<path d="M14 4h6v6M20 4l-9 9"></path><path d="M18 13v6H5V6h6"></path>',
    arrow: '<path d="M4 12h16M14 6l6 6-6 6"></path>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" aria-hidden="true">${paths[name] ?? ""}</svg>`;
}

function absoluteUrl(siteUrl, route = "/") {
  const base = String(siteUrl).replace(/\/$/, "");
  const suffix = route === "/" ? "/" : encodeRoute(route);
  return `${base}${suffix}`;
}

function displayDate(value) {
  const string = String(value ?? "");
  const match = string.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : string;
}

function pageLabel(page) {
  return page.route === "/" ? "홈" : page.data.title;
}

function pageStatusBadge(page) {
  return `<span class="status-badge status-${escapeAttr(page.data.status)}">${escapeHtml(statusLabel(page.data.status))}</span>`;
}

function renderTopbar({ basePath, repositoryUrl }) {
  const primary = ["concepts", "analyses", "entities", "sources"]
    .map((category) => `<a href="${siteHref(basePath, `/${category}/`)}">${escapeHtml(CATEGORY_META[category].shortLabel)}</a>`)
    .join("");
  return `
    <header class="topbar">
      <a class="brand" href="${siteHref(basePath, "/")}" aria-label="대한민국 노동법 위키 홈">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>대한민국 노동법 위키</span>
      </a>
      <nav class="topnav" aria-label="주요 분류">${primary}</nav>
      <div class="top-actions">
        <a class="repository-link" href="${escapeAttr(repositoryUrl)}" target="_blank" rel="noopener noreferrer">GitHub 저장소 ${svgIcon("external")}</a>
        <button class="search-trigger" type="button" data-search-open aria-haspopup="dialog" aria-label="문서 검색">
          ${svgIcon("search")}<span>검색</span><kbd>Ctrl K</kbd>
        </button>
        <button class="menu-trigger" type="button" data-menu-toggle aria-controls="sidebar" aria-expanded="false" aria-label="문서 메뉴">
          ${svgIcon("menu")}<span>메뉴</span>
        </button>
      </div>
    </header>`;
}

function renderSidebar({ wiki, currentPage, currentCategory, basePath }) {
  const homeActive = currentPage?.route === "/" ? " is-active" : "";
  const catalogActive = currentPage?.route === "/catalog/" ? " is-active" : "";
  const groups = CATEGORY_ORDER.map((category) => {
    const meta = CATEGORY_META[category];
    const pages = wiki.groups[category];
    const current = currentCategory === category;
    const pageList = current
      ? `<ul class="sidebar-pages">${pages.map((page) => {
          const active = currentPage?.route === page.route ? ' class="is-active" aria-current="page"' : "";
          return `<li><a${active} href="${siteHref(basePath, page.route)}">${escapeHtml(pageLabel(page))}</a></li>`;
        }).join("")}</ul>`
      : "";
    return `<li class="sidebar-group${current ? " is-current" : ""}">
      <a class="sidebar-group-link" href="${siteHref(basePath, `/${category}/`)}">
        <span class="nav-number">${meta.number}</span>
        <span><strong>${escapeHtml(meta.shortLabel)}</strong><small>${pages.length}개 문서</small></span>
      </a>
      ${pageList}
    </li>`;
  }).join("");
  return `
    <aside class="sidebar" id="sidebar" aria-label="문서 탐색">
      <div class="sidebar-head">
        <span>문서 탐색</span>
        <button type="button" class="sidebar-close" data-menu-close>${svgIcon("close")}<span class="sr-only">메뉴 닫기</span></button>
      </div>
      <nav>
        <ul class="sidebar-shortcuts">
          <li><a class="${homeActive.trim()}" href="${siteHref(basePath, "/")}"><span class="nav-number">00</span><span>개요</span></a></li>
          <li><a class="${catalogActive.trim()}" href="${siteHref(basePath, "/catalog/")}"><span class="nav-number">06</span><span>전체 색인</span></a></li>
        </ul>
        <ol class="sidebar-groups">${groups}</ol>
      </nav>
    </aside>
    <button class="menu-backdrop" type="button" data-menu-close tabindex="-1" aria-label="메뉴 닫기"></button>`;
}

function renderSearchDialog(basePath) {
  return `
    <dialog class="search-dialog" id="search-dialog" data-search-url="${siteHref(basePath, "/search.json")}" aria-labelledby="search-dialog-title">
      <div class="search-head">
        <div><span class="dialog-number">S</span><h2 id="search-dialog-title">문서 검색</h2></div>
        <button type="button" class="dialog-close" data-search-close>${svgIcon("close")}<span>닫기</span></button>
      </div>
      <label class="search-field">
        <span class="sr-only">검색어</span>
        ${svgIcon("search")}
        <input type="search" autocomplete="off" spellcheck="false" placeholder="개념, 사건번호, 출처 ID 검색" data-search-input>
      </label>
      <p class="search-guidance" data-search-guidance>제목·별칭·본문·사건번호·출처 ID를 검색합니다.</p>
      <div class="search-results" data-search-results aria-live="polite"></div>
    </dialog>`;
}

function renderFooter({ basePath, latestUpdated }) {
  return `
    <footer class="site-footer">
      <p>이 위키는 법률 자문이 아니라 법령 버전과 근거 범위를 드러내는 백과사전적 지식베이스입니다.</p>
      <div>
        <span>최근 갱신 ${escapeHtml(displayDate(latestUpdated))}</span>
        <a href="${siteHref(basePath, "/meta/출처-추적-및-최신성-관리/")}">출처 관리 원칙</a>
        <a href="${siteHref(basePath, "/log/")}">작업 기록</a>
      </div>
    </footer>`;
}

function renderStatusNotice(page) {
  if (page.data.status === "review") {
    return `<aside class="status-notice" role="note"><strong>검토 중</strong><span>이 문서는 확인이 필요한 쟁점 또는 모순 경고를 포함합니다.</span></aside>`;
  }
  if (page.data.status === "draft") {
    return `<aside class="status-notice" role="note"><strong>초안</strong><span>이 문서는 구조 또는 근거를 보강 중입니다.</span></aside>`;
  }
  if (page.data.status === "archived") {
    return `<aside class="status-notice" role="note"><strong>보관 문서</strong><span>현재 설명이 아니라 역사적 기록으로 유지되는 문서입니다.</span></aside>`;
  }
  return "";
}

function renderEvidencePanel(page, basePath) {
  if (!page.sourcePages.length) return "";
  const items = page.sourcePages.map((source, index) => `
    <li>
      <span class="evidence-index">${String(index + 1).padStart(2, "0")}</span>
      <a href="${siteHref(basePath, source.route)}">${escapeHtml(source.data.title)}</a>
      <span>${escapeHtml(sourceTypeLabel(source.data.source_type))}</span>
    </li>`).join("");
  return `<details class="evidence-panel">
    <summary><span>근거 자료</span><strong>${page.sourcePages.length}</strong></summary>
    <ol>${items}</ol>
  </details>`;
}

function renderSourceRecord(page, { basePath, repositoryUrl, repositoryRef }) {
  if (page.category !== "sources") return "";
  const data = page.data;
  const fields = [
    ["출처 ID", data.source_id],
    ["자료 유형", sourceTypeLabel(data.source_type)],
    ["발행기관·매체", data.publisher],
    ["발행일", data.publication_date || data.publication_period],
    ["결정일", data.decision_date],
    ["기준일", data.as_of_date],
    ["시행일", data.effective_date],
    ["조회일", data.retrieved],
    ["법령 버전", data.version]
  ].filter(([, value]) => value);
  const details = fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(displayDate(value))}</dd></div>`).join("");
  const sourceUrls = data.source_urls.map((url, index) => `<li><a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">원문 링크 ${index + 1} ${svgIcon("external")}</a></li>`).join("");
  const repoFileLink = (file) => {
    const encoded = file.split("/").map(encodeURIComponent).join("/");
    return `${repositoryUrl}/blob/${encodeURIComponent(repositoryRef)}/${encoded}`;
  };
  const rawLinks = data.raw_sources.map((file) => `<li><a href="${escapeAttr(repoFileLink(file))}" target="_blank" rel="noopener noreferrer">${escapeHtml(path.posix.basename(file))} ${svgIcon("external")}</a></li>`).join("");
  const attachmentLinks = data.attachments.map((file) => `<li><a href="${escapeAttr(repoFileLink(file))}" target="_blank" rel="noopener noreferrer">첨부: ${escapeHtml(path.posix.basename(file))} ${svgIcon("external")}</a></li>`).join("");
  const related = page.relatedSources.map((source) => `<li><a href="${siteHref(basePath, source.route)}">${escapeHtml(source.data.title)}</a></li>`).join("");
  const superseded = page.supersedingSource ? `<p class="superseded-link"><span>대체 자료</span><a href="${siteHref(basePath, page.supersedingSource.route)}">${escapeHtml(page.supersedingSource.data.title)}</a></p>` : "";
  const links = sourceUrls || rawLinks || attachmentLinks ? `<div class="record-links">
    ${sourceUrls ? `<section><h3>웹 원문</h3><ul>${sourceUrls}</ul></section>` : ""}
    ${rawLinks || attachmentLinks ? `<section><h3>저장 원본</h3><ul>${rawLinks}${attachmentLinks}</ul></section>` : ""}
  </div>` : "";
  return `<section class="source-record" aria-labelledby="source-record-title">
    <header><span class="record-number">R</span><h2 id="source-record-title">출처 기록</h2></header>
    <dl>${details}</dl>
    ${links}
    ${related ? `<div class="related-sources"><h3>직접 관련 자료</h3><ul>${related}</ul></div>` : ""}
    ${superseded}
  </section>`;
}

function renderCitedBy(page, basePath) {
  if (page.category !== "sources" || !page.citedBy.length) return "";
  const items = page.citedBy.map((citingPage) => `<li><a href="${siteHref(basePath, citingPage.route)}">${escapeHtml(citingPage.data.title)}</a><span>${escapeHtml(CATEGORY_META[citingPage.category].shortLabel)}</span></li>`).join("");
  return `<details class="cited-by-panel">
    <summary><span>이 자료를 근거로 사용하는 문서</span><strong>${page.citedBy.length}</strong></summary>
    <ul>${items}</ul>
  </details>`;
}

function renderToc(toc, basePath, pageRoute) {
  if (!toc.length) return "";
  return `<aside class="page-toc" aria-label="이 문서의 목차">
    <p>이 문서의 목차</p>
    <ol>${toc.map((heading, index) => `<li class="toc-level-${heading.level}"><a href="${siteHref(basePath, `${pageRoute}#${heading.id}`)}" data-toc-link data-section-index="${String(index + 1).padStart(2, "0")}">${escapeHtml(heading.title)}</a></li>`).join("")}</ol>
  </aside>`;
}

function renderPrevNext(page, wiki, basePath) {
  if (page.route === "/") return "";
  const pages = wiki.groups[page.category];
  const index = pages.indexOf(page);
  const previous = index > 0 ? pages[index - 1] : null;
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null;
  if (!previous && !next) return "";
  return `<nav class="prev-next" aria-label="같은 분류의 이전·다음 문서">
    ${previous ? `<a class="previous" href="${siteHref(basePath, previous.route)}"><span>이전 문서</span><strong>${escapeHtml(previous.data.title)}</strong></a>` : "<span></span>"}
    ${next ? `<a class="next" href="${siteHref(basePath, next.route)}"><span>다음 문서</span><strong>${escapeHtml(next.data.title)}</strong>${svgIcon("arrow")}</a>` : "<span></span>"}
  </nav>`;
}

function renderHomeStats(wiki, basePath) {
  const stats = [
    ["전체 문서", wiki.stats.pages, "/catalog/"],
    ["출처", wiki.stats.sources, "/sources/"],
    ["개념", wiki.stats.concepts, "/concepts/"],
    ["분석", wiki.stats.analyses, "/analyses/"]
  ];
  return `<section class="home-stats" aria-label="위키 현황">${stats.map(([label, value, route], index) => `<a href="${siteHref(basePath, route)}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${value}</strong><small>${escapeHtml(label)}</small></a>`).join("")}</section>`;
}

function renderHead({ title, description, canonical, basePath, page, siteName, siteUrl, pageKind, noindex }) {
  const structuredType = page?.category === "sources"
    ? "CreativeWork"
    : pageKind === "collection"
      ? "CollectionPage"
      : page
        ? "Article"
        : "WebPage";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": structuredType,
    headline: title,
    description,
    inLanguage: "ko-KR",
    isPartOf: { "@type": "WebSite", name: siteName, url: `${String(siteUrl).replace(/\/$/, "")}/` },
    ...(page?.data.created ? { dateCreated: page.data.created } : {}),
    ...(page?.data.updated ? { dateModified: page.data.updated } : {})
  };
  const safeJson = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
  const structuredData = pageKind === "not-found" ? "" : `<script type="application/ld+json">${safeJson}</script>`;
  return `
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} · ${escapeHtml(siteName)}</title>
    <meta name="description" content="${escapeAttr(description)}">
    <meta name="theme-color" content="#002FA7">
    ${noindex ? '<meta name="robots" content="noindex,follow">' : ""}
    <link rel="canonical" href="${escapeAttr(canonical)}">
    <link rel="icon" href="${siteHref(basePath, "/assets/favicon.svg")}" type="image/svg+xml">
    <link rel="manifest" href="${siteHref(basePath, "/manifest.webmanifest")}">
    <link rel="sitemap" type="application/xml" href="${siteHref(basePath, "/sitemap.xml")}">
    <link rel="stylesheet" href="${siteHref(basePath, "/assets/styles.css")}">
    <meta property="og:type" content="${page ? "article" : "website"}">
    <meta property="og:locale" content="ko_KR">
    <meta property="og:site_name" content="${escapeAttr(siteName)}">
    <meta property="og:title" content="${escapeAttr(title)}">
    <meta property="og:description" content="${escapeAttr(description)}">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    ${structuredData}`;
}

function renderShell({ wiki, page = null, currentCategory, title, description, canonical, main, basePath, repositoryUrl, siteUrl, initialRail = "문서 개요", pageKind = "page", noindex = false }) {
  const siteName = "대한민국 노동법 위키";
  return `<!doctype html>
<html lang="ko" data-base-path="${escapeAttr(basePath)}">
  <head>${renderHead({ title, description, canonical, basePath, page, siteName, siteUrl, pageKind, noindex })}</head>
  <body>
    <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
    ${renderTopbar({ basePath, repositoryUrl })}
    ${renderSidebar({ wiki, currentPage: page, currentCategory, basePath })}
    <div class="page-frame">${main}${renderFooter({ basePath, latestUpdated: wiki.stats.latestUpdated })}</div>
    <aside class="reading-rail" aria-live="polite" aria-atomic="true"><span data-rail-index>00</span><span data-rail-title>${escapeHtml(initialRail)}</span></aside>
    ${renderSearchDialog(basePath)}
    <script type="module" src="${siteHref(basePath, "/assets/app.js")}"></script>
  </body>
</html>`;
}

export function renderPage({ page, rendered, wiki, basePath, siteUrl, repositoryUrl, repositoryRef }) {
  const category = CATEGORY_META[page.category];
  const isHome = page.route === "/";
  const folio = isHome ? "00" : category.number;
  const canonical = absoluteUrl(siteUrl, page.route);
  const articleHtml = isHome ? rendered.html.split(/<h2(?:\s|>)/, 1)[0].trim() : rendered.html;
  const aliases = page.data.aliases.length ? `<p class="aliases"><span>다른 이름</span>${page.data.aliases.map((alias) => `<span>${escapeHtml(alias)}</span>`).join("")}</p>` : "";
  const metaFacts = [
    pageStatusBadge(page),
    page.data.updated ? `<span>갱신 ${escapeHtml(displayDate(page.data.updated))}</span>` : "",
    page.sourceCount ? `<span>근거 ${page.sourceCount}</span>` : "",
    page.data.legal_area ? `<span>${escapeHtml(page.data.legal_area)}</span>` : ""
  ].filter(Boolean).join("");
  const main = `<main id="main-content" class="main-content">
    <nav class="breadcrumbs" aria-label="현재 위치"><a href="${siteHref(basePath, "/")}">홈</a><span>/</span><a href="${siteHref(basePath, `/${page.category}/`)}">${escapeHtml(category.shortLabel)}</a></nav>
    <header class="page-hero">
      <div class="page-folio" aria-hidden="true">${folio}</div>
      <div class="page-hero-content">
        <p class="page-kicker">${escapeHtml(category.label)}</p>
        <h1>${escapeHtml(page.data.title)}</h1>
        ${aliases}
        <div class="page-facts">${metaFacts}</div>
      </div>
    </header>
    ${isHome ? renderHomeStats(wiki, basePath) : ""}
    ${renderStatusNotice(page)}
    ${renderSourceRecord(page, { basePath, repositoryUrl, repositoryRef })}
    ${renderEvidencePanel(page, basePath)}
    ${renderCitedBy(page, basePath)}
    <div class="article-layout${isHome ? " home-description-layout" : ""}">
      <article class="prose${isHome ? " home-description" : ""}">${articleHtml}</article>
      ${isHome ? "" : renderToc(rendered.toc, basePath, page.route)}
    </div>
    ${renderPrevNext(page, wiki, basePath)}
  </main>`;
  return renderShell({
    wiki,
    page,
    currentCategory: page.category,
    title: page.data.title,
    description: page.excerpt || `${page.data.title} 문서`,
    canonical,
    main,
    basePath,
    repositoryUrl,
    siteUrl,
    initialRail: isHome ? page.data.title : rendered.toc[0]?.title || page.data.title
  });
}

export function renderCategoryPage({ category, wiki, basePath, siteUrl, repositoryUrl }) {
  const meta = CATEGORY_META[category];
  const pages = [...wiki.groups[category]].sort((a, b) => collator.compare(a.data.title, b.data.title));
  const cards = pages.map((page, index) => `<li>
    <a href="${siteHref(basePath, page.route)}">
      <span class="card-index">${String(index + 1).padStart(2, "0")}</span>
      <div><h2>${escapeHtml(page.data.title)}</h2><p>${escapeHtml(page.excerpt)}</p></div>
      <footer>${pageStatusBadge(page)}<span>근거 ${page.sourceCount}</span><span>${escapeHtml(displayDate(page.data.updated))}</span></footer>
    </a>
  </li>`).join("");
  const route = `/${category}/`;
  const main = `<main id="main-content" class="main-content category-main">
    <nav class="breadcrumbs" aria-label="현재 위치"><a href="${siteHref(basePath, "/")}">홈</a><span>/</span><span>${escapeHtml(meta.shortLabel)}</span></nav>
    <header class="category-hero"><span class="category-number" aria-hidden="true">${meta.number}</span><div><p>${pages.length}개 문서</p><h1>${escapeHtml(meta.shortLabel)}</h1><p>${escapeHtml(meta.description)}</p></div></header>
    <ol class="document-grid">${cards}</ol>
  </main>`;
  return renderShell({
    wiki,
    currentCategory: category,
    title: meta.shortLabel,
    description: meta.description,
    canonical: absoluteUrl(siteUrl, route),
    main,
    basePath,
    repositoryUrl,
    siteUrl,
    initialRail: meta.shortLabel,
    pageKind: "collection"
  });
}

export function renderNotFound({ wiki, basePath, siteUrl, repositoryUrl }) {
  const main = `<main id="main-content" class="main-content error-main">
    <div class="error-code" aria-hidden="true">404</div>
    <div><h1>페이지를 찾을 수 없습니다</h1><p>주소가 바뀌었거나 존재하지 않는 문서입니다. 전체 색인이나 검색에서 문서를 찾아보세요.</p><div class="error-actions"><a href="${siteHref(basePath, "/catalog/")}">전체 색인</a><button type="button" data-search-open>문서 검색</button></div></div>
  </main>`;
  return renderShell({
    wiki,
    currentCategory: "meta",
    title: "페이지를 찾을 수 없습니다",
    description: "요청한 노동법 위키 문서를 찾을 수 없습니다.",
    canonical: absoluteUrl(siteUrl, "/404.html"),
    main,
    basePath,
    repositoryUrl,
    siteUrl,
    initialRail: "페이지 없음",
    pageKind: "not-found",
    noindex: true
  });
}
