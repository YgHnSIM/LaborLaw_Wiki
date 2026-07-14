import path from "node:path";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  confidenceLabel,
  encodeRoute,
  legalStatusLabel,
  siteHref,
  sourceTypeLabel,
  statusLabel
} from "./lib/wiki.mjs";

const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
const LEGAL_AREA_ORDER = ["근로기준", "집단노동", "산재", "고용평등", "비정규직", "퇴직급여", "중대재해", "입법사"];
const SEARCH_SOURCE_TYPES = ["official_law", "official_decision", "official_guidance", "official_record", "legal_excerpt", "academic_paper", "research_report", "practitioner_commentary", "news", "stakeholder_statement", "llm_report"];

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

function renderTime(value) {
  return value ? `<time datetime="${escapeAttr(value)}">${escapeHtml(displayDate(value))}</time>` : "";
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
    const currentIndex = currentPage ? pages.indexOf(currentPage) : -1;
    const visibleStart = Math.max(0, Math.min(currentIndex - 5, pages.length - 11));
    const visiblePages = currentIndex >= 0 ? pages.slice(visibleStart, visibleStart + 11) : [];
    const pageList = current && visiblePages.length
      ? `<ul class="sidebar-pages">${visiblePages.map((page) => {
          const index = pages.indexOf(page);
          const active = currentPage?.route === page.route ? ' class="is-active" aria-current="page"' : "";
          return `<li><a${active} href="${siteHref(basePath, page.route)}"><span class="sidebar-page-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><span class="sidebar-page-label">${escapeHtml(pageLabel(page))}</span></a></li>`;
        }).join("")}<li class="sidebar-pages-all"><a href="${siteHref(basePath, `/${category}/`)}">전체 ${pages.length}개 문서 보기</a></li></ul>`
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
  const categoryOptions = CATEGORY_ORDER.map((category) => `<option value="${category}">${escapeHtml(CATEGORY_META[category].shortLabel)}</option>`).join("");
  const areaOptions = LEGAL_AREA_ORDER.map((area) => `<option value="${escapeAttr(area)}">${escapeHtml(area)}</option>`).join("");
  const sourceTypeOptions = SEARCH_SOURCE_TYPES.map((type) => `<option value="${type}">${escapeHtml(sourceTypeLabel(type))}</option>`).join("");
  return `
    <dialog class="search-dialog" id="search-dialog" data-search-url="${siteHref(basePath, "/search.json")}" aria-labelledby="search-dialog-title">
      <div class="search-head">
        <div><span class="dialog-number">S</span><h2 id="search-dialog-title">문서 검색</h2></div>
        <button type="button" class="dialog-close" data-search-close>${svgIcon("close")}<span>닫기</span></button>
      </div>
      <label class="search-field">
        <span class="sr-only">검색어</span>
        ${svgIcon("search")}
        <input id="search-input" type="search" role="combobox" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false" aria-describedby="search-guidance search-status" autocomplete="off" spellcheck="false" placeholder="개념, 사건번호, 출처 ID 검색" data-search-input>
      </label>
      <div class="search-filters" aria-label="검색 필터">
        <label><span>분류</span><select data-search-category><option value="">전체</option>${categoryOptions}</select></label>
        <label><span>상태</span><select data-search-status><option value="">전체</option><option value="active">활성</option><option value="draft">초안</option><option value="review">검토</option><option value="archived">보관</option></select></label>
        <label><span>영역</span><select data-search-area><option value="">전체</option>${areaOptions}</select></label>
        <label><span>자료</span><select data-search-source-type><option value="">전체</option>${sourceTypeOptions}</select></label>
        <label><span>법적 상태</span><select data-search-legal-status><option value="">전체</option><option value="current">현행</option><option value="amended">개정됨</option><option value="repealed">폐지됨</option><option value="overruled">판례 변경</option><option value="superseded">대체됨</option><option value="uncertain">확인 필요</option></select></label>
        <label><span>날짜 정보</span><select data-search-date-kind><option value="">전체</option><option value="asOfDate">지식 기준일 있음</option><option value="effectiveDate">시행일 있음</option><option value="decisionDate">결정일 있음</option></select></label>
      </div>
      <p class="search-guidance" id="search-guidance">제목 완전일치와 별칭을 우선해 본문·사건번호·출처 ID까지 검색합니다.</p>
      <p class="sr-only" id="search-status" role="status" aria-live="polite" aria-atomic="true" data-search-status-text></p>
      <div class="search-results" id="search-results" role="listbox" aria-label="검색 결과" data-search-results></div>
    </dialog>`;
}

function renderFooter({ basePath, stats }) {
  const knowledgeDate = stats.knowledgeAsOf || stats.latestContentUpdated;
  return `
    <footer class="site-footer">
      <p>이 위키는 법률 자문이 아니라 법령 버전과 근거 범위를 드러내는 백과사전적 지식베이스입니다.</p>
      <div>
        ${knowledgeDate ? `<span>지식 기준일 ${renderTime(knowledgeDate)}</span>` : ""}
        ${stats.latestContentUpdated ? `<span>콘텐츠 수정 ${renderTime(stats.latestContentUpdated)}</span>` : ""}
        ${stats.latestUpdated && stats.latestUpdated !== stats.latestContentUpdated ? `<span>운영 기록 ${renderTime(stats.latestUpdated)}</span>` : ""}
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

function renderEvidenceStrip(page) {
  const facts = [];
  const add = (label, value, className = "") => {
    if (!value) return;
    facts.push(`<div${className ? ` class="${className}"` : ""}><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`);
  };
  add("문서 상태", pageStatusBadge(page), "fact-status");
  add("지식 기준일", renderTime(page.data.as_of_date));
  add("시행일", renderTime(page.data.effective_date));
  if (!page.data.effective_date) add("결정일", renderTime(page.data.decision_date));
  add("최종 수정", renderTime(page.data.updated));
  add("법적 상태", escapeHtml(legalStatusLabel(page.data.legal_status)));
  add("근거 확신", escapeHtml(confidenceLabel(page.data.confidence)));
  if (page.sourceCount) {
    const value = page.category === "sources"
      ? `${page.sourceCount}개 원문`
      : `${page.sourceCount}개${page.officialSourceCount ? ` · 공식 ${page.officialSourceCount}` : ""}`;
    add(page.category === "sources" ? "원문 기록" : "연결 근거", escapeHtml(value));
  }
  add("다음 검토", renderTime(page.data.next_review_date), "fact-review-date");
  return `<dl class="page-facts evidence-strip" aria-label="문서 신뢰 정보">${facts.join("")}</dl>`;
}

function renderEvidencePanel(page, basePath) {
  if (!page.sourcePages.length) return "";
  const items = page.sourcePages.map((source, index) => `
    <li id="evidence-${escapeAttr(source.data.source_id)}" tabindex="-1">
      <span class="evidence-index">${String(index + 1).padStart(2, "0")}</span>
      <div><a href="${siteHref(basePath, source.route)}">${escapeHtml(source.data.title)}</a>${source.data.publisher ? `<small>${escapeHtml(source.data.publisher)}</small>` : ""}</div>
      <span>${source.data.source_type.startsWith("official_") ? "공식" : "보조"} · ${escapeHtml(sourceTypeLabel(source.data.source_type))}</span>
    </li>`).join("");
  return `<details class="evidence-panel">
    <summary><span>근거 자료</span><small>공식 ${page.officialSourceCount} · 보조 ${page.supportingSourceCount}</small><strong>${page.sourcePages.length}</strong></summary>
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

function renderMobileToc(toc, basePath, pageRoute) {
  if (!toc.length) return "";
  return `<details class="mobile-toc" data-mobile-toc>
    <summary><span>이 문서에서</span><strong data-mobile-toc-current>${escapeHtml(toc[0].title)}</strong><small>${toc.length}개 절</small></summary>
    <progress max="100" value="0" aria-label="문서 읽기 진행률" data-reading-progress></progress>
    <ol>${toc.map((heading, index) => `<li class="toc-level-${heading.level}"><a href="${siteHref(basePath, `${pageRoute}#${heading.id}`)}" data-toc-link data-section-index="${String(index + 1).padStart(2, "0")}">${escapeHtml(heading.title)}</a></li>`).join("")}</ol>
    <button type="button" data-scroll-top>맨 위로</button>
  </details>`;
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

function renderHomeSearch(basePath) {
  const suggestions = ["통상임금", "해고", "근로시간", "산업재해", "원하청 교섭"];
  return `<section class="home-search" aria-labelledby="home-search-title">
    <header><span aria-hidden="true">S</span><div><h2 id="home-search-title">노동법 문서 찾기</h2><p>개념, 사건번호, 법령과 출처 ID를 한 번에 검색합니다.</p></div></header>
    <button class="home-search-launch" type="button" data-search-open>${svgIcon("search")}<span>확인하려는 개념이나 사건번호를 입력하세요</span><kbd>/</kbd></button>
    <div class="home-search-suggestions"><span>바로 찾기</span>${suggestions.map((query) => `<button type="button" data-search-open data-search-preset-query="${escapeAttr(query)}">${escapeHtml(query)}</button>`).join("")}</div>
  </section>`;
}

function renderHomeStats(wiki, basePath) {
  const facts = [
    ["지식 기준일", renderTime(wiki.stats.knowledgeAsOf || wiki.stats.latestContentUpdated), ""],
    ["출처 기록", `<strong>${wiki.stats.sources}</strong>개`, "/sources/"],
    ["검증 완료", `<strong>${wiki.stats.statuses.active ?? 0}</strong>개`, "/catalog/"],
    ["검토 필요", `<strong>${wiki.stats.statuses.review ?? 0}</strong>개`, "review"]
  ];
  return `<section class="home-stats" aria-label="지식베이스 신뢰 현황">${facts.map(([label, value, target]) => {
    const inner = `<span>${escapeHtml(label)}</span><div>${value}</div>`;
    if (target === "review") return `<button type="button" data-search-open data-search-preset-status="review">${inner}</button>`;
    if (target) return `<a href="${siteHref(basePath, target)}">${inner}</a>`;
    return `<div>${inner}</div>`;
  }).join("")}</section>`;
}

function renderAreaDashboard(wiki) {
  const counts = new Map();
  for (const page of wiki.pages) {
    const area = page.data.legal_area;
    if (!area) continue;
    const current = counts.get(area) ?? { total: 0, active: 0, draft: 0, review: 0 };
    current.total += 1;
    current[page.data.status] = (current[page.data.status] ?? 0) + 1;
    counts.set(area, current);
  }
  const areas = [...counts.entries()].sort((a, b) => {
    const aIndex = LEGAL_AREA_ORDER.indexOf(a[0]);
    const bIndex = LEGAL_AREA_ORDER.indexOf(b[0]);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || collator.compare(a[0], b[0]);
  });
  return `<section class="home-dashboard home-area-dashboard" aria-labelledby="home-area-title">
    <header><span>01</span><div><h2 id="home-area-title">영역별 현황</h2><p>문서의 법률 영역과 현재 검토 상태를 함께 봅니다.</p></div></header>
    <ul>${areas.map(([area, count]) => `<li><button type="button" data-search-open data-search-preset-area="${escapeAttr(area)}"><strong>${escapeHtml(area)}</strong><span>${count.total}개</span><small>활성 ${count.active || 0} · 초안 ${count.draft || 0} · 검토 ${count.review || 0}</small></button></li>`).join("")}</ul>
  </section>`;
}

function renderHomeCollections(wiki, basePath) {
  const analyses = [...wiki.groups.analyses]
    .sort((a, b) => b.sourceCount - a.sourceCount || b.data.updated.localeCompare(a.data.updated) || collator.compare(a.data.title, b.data.title))
    .slice(0, 4);
  const recent = wiki.pages
    .filter((page) => page.category !== "meta" && page.data.as_of_date)
    .sort((a, b) => b.data.as_of_date.localeCompare(a.data.as_of_date) || b.officialSourceCount - a.officialSourceCount || collator.compare(a.data.title, b.data.title))
    .slice(0, 6);
  const review = wiki.pages
    .filter((page) => page.data.status === "review")
    .sort((a, b) => b.data.updated.localeCompare(a.data.updated) || collator.compare(a.data.title, b.data.title))
    .slice(0, 6);
  const list = (pages, kind) => pages.map((page, index) => `<li><a href="${siteHref(basePath, page.route)}"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(page.data.title)}</strong><small>${kind === "analysis" ? `근거 ${page.sourceCount} · 공식 ${page.officialSourceCount}` : kind === "recent" ? `${escapeHtml(CATEGORY_META[page.category].shortLabel)} · 기준 ${escapeHtml(displayDate(page.data.as_of_date))}` : `${escapeHtml(CATEGORY_META[page.category].shortLabel)} · 수정 ${escapeHtml(displayDate(page.data.updated))}`}</small></div></a></li>`).join("");
  return `<div class="home-collections">
    <section class="home-dashboard" aria-labelledby="home-analysis-title"><header><span>02</span><div><h2 id="home-analysis-title">근거 연결이 많은 분석</h2><p>여러 출처를 종합한 분석 문서입니다.</p></div></header><ol>${list(analyses, "analysis")}</ol><a class="dashboard-more" href="${siteHref(basePath, "/analyses/")}">분석 전체 보기</a></section>
    <section class="home-dashboard" aria-labelledby="home-recent-title"><header><span>03</span><div><h2 id="home-recent-title">최근 검증 문서</h2><p>명시된 지식 기준일과 공식 근거 수를 기준으로 정렬했습니다.</p></div></header><ol>${list(recent, "recent")}</ol><a class="dashboard-more" href="${siteHref(basePath, "/catalog/")}">전체 색인 보기</a></section>
    <section class="home-dashboard" aria-labelledby="home-review-title"><header><span>04</span><div><h2 id="home-review-title">검토가 필요한 문서</h2><p>모순 경고나 추가 확인 사항이 남아 있습니다.</p></div></header><ol>${list(review, "review")}</ol>${review.length < (wiki.stats.statuses.review ?? 0) ? `<button class="dashboard-more" type="button" data-search-open data-search-preset-status="review">검토 문서 전체 보기</button>` : ""}</section>
  </div>`;
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
    <meta name="theme-color" content="#0000FF">
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
<html lang="ko" data-base-path="${escapeAttr(basePath)}" data-design="brutalist-gazette">
  <head>${renderHead({ title, description, canonical, basePath, page, siteName, siteUrl, pageKind, noindex })}</head>
  <body>
    <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
    ${renderTopbar({ basePath, repositoryUrl })}
    ${renderSidebar({ wiki, currentPage: page, currentCategory, basePath })}
    <div class="page-frame">${main}${renderFooter({ basePath, stats: wiki.stats })}</div>
    ${page && page.route !== "/" ? `<aside class="reading-rail" aria-live="polite" aria-atomic="true"><span data-rail-index>00</span><span data-rail-title>${escapeHtml(initialRail)}</span></aside>` : ""}
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
  const articleHtml = rendered.contentHtml;
  const aliases = page.data.aliases.length ? `<dl class="aliases"><dt>다른 이름</dt><dd>${page.data.aliases.map((alias) => `<span>${escapeHtml(alias)}</span>`).join("")}</dd></dl>` : "";
  const breadcrumbs = isHome ? "" : `<nav class="breadcrumbs" aria-label="현재 위치"><a href="${siteHref(basePath, "/")}">홈</a><span aria-hidden="true">/</span><a href="${siteHref(basePath, `/${page.category}/`)}">${escapeHtml(category.shortLabel)}</a></nav>`;
  const toc = isHome ? [] : rendered.toc;
  const main = `<main id="main-content" class="main-content">
    ${breadcrumbs}
    <header class="page-hero${isHome ? " is-home" : ""}">
      <div class="page-folio" aria-hidden="true">${folio}</div>
      <div class="page-hero-content">
        <p class="page-kicker">${escapeHtml(category.label)}</p>
        <h1>${escapeHtml(page.data.title)}</h1>
        ${page.excerpt ? `<p class="page-summary">${escapeHtml(page.excerpt)}</p>` : ""}
        ${aliases}
        ${renderEvidenceStrip(page)}
      </div>
    </header>
    ${isHome ? renderHomeSearch(basePath) : ""}
    ${isHome ? renderHomeStats(wiki, basePath) : ""}
    ${isHome ? renderAreaDashboard(wiki) : ""}
    ${isHome ? renderHomeCollections(wiki, basePath) : ""}
    ${renderStatusNotice(page)}
    ${renderSourceRecord(page, { basePath, repositoryUrl, repositoryRef })}
    ${renderEvidencePanel(page, basePath)}
    ${renderCitedBy(page, basePath)}
    ${renderMobileToc(toc, basePath, page.route)}
    <div class="article-layout">
      <article class="prose${isHome ? " home-description" : ""}"${!isHome && toc.length ? " data-reading-article" : ""}>${articleHtml}</article>
      ${renderToc(toc, basePath, page.route)}
    </div>
    ${renderPrevNext(page, wiki, basePath)}
  </main>`;
  return renderShell({
    wiki,
    page,
    currentCategory: page.category === "meta" && ["/", "/catalog/", "/log/"].includes(page.route) ? null : page.category,
    title: page.data.title,
    description: page.excerpt || `${page.data.title} 문서`,
    canonical,
    main,
    basePath,
    repositoryUrl,
    siteUrl,
    initialRail: toc[0]?.title || page.data.title
  });
}

export function renderCategoryPage({ category, wiki, basePath, siteUrl, repositoryUrl }) {
  const meta = CATEGORY_META[category];
  const pages = [...wiki.groups[category]].sort((a, b) => collator.compare(a.data.title, b.data.title));
  const statusCounts = pages.reduce((counts, page) => {
    counts[page.data.status] = (counts[page.data.status] ?? 0) + 1;
    return counts;
  }, {});
  const areas = [...new Set(pages.map((page) => page.data.legal_area).filter(Boolean))].sort((a, b) => collator.compare(a, b));
  const cards = pages.map((page, index) => `<li data-document-card data-status="${escapeAttr(page.data.status)}" data-area="${escapeAttr(page.data.legal_area || "")}">
    <a href="${siteHref(basePath, page.route)}">
      <span class="card-index">${String(index + 1).padStart(2, "0")}</span>
      <div><h2>${escapeHtml(page.data.title)}</h2><p>${escapeHtml(page.excerpt)}</p></div>
      <footer>${pageStatusBadge(page)}<span>${page.category === "sources" ? "원문" : "근거"} ${page.sourceCount}</span><span>${page.data.as_of_date ? `기준 ${escapeHtml(displayDate(page.data.as_of_date))}` : `수정 ${escapeHtml(displayDate(page.data.updated))}`}</span></footer>
    </a>
  </li>`).join("");
  const areaOptions = areas.map((area) => `<option value="${escapeAttr(area)}">${escapeHtml(area)}</option>`).join("");
  const route = `/${category}/`;
  const main = `<main id="main-content" class="main-content category-main">
    <nav class="breadcrumbs" aria-label="현재 위치"><a href="${siteHref(basePath, "/")}">홈</a><span>/</span><span>${escapeHtml(meta.shortLabel)}</span></nav>
    <header class="category-hero"><span class="category-number" aria-hidden="true">${meta.number}</span><div><p>${pages.length}개 문서</p><h1>${escapeHtml(meta.shortLabel)}</h1><p>${escapeHtml(meta.description)}</p><p class="category-maturity">활성 ${statusCounts.active ?? 0} · 초안 ${statusCounts.draft ?? 0} · 검토 ${statusCounts.review ?? 0}</p></div></header>
    <div class="category-controls" data-category-filters>
      <p role="status" aria-live="polite" aria-atomic="true"><strong data-category-count>${pages.length}</strong>개 문서 표시</p>
      <label><span>상태</span><select data-category-status><option value="">전체</option><option value="active">활성</option><option value="draft">초안</option><option value="review">검토</option><option value="archived">보관</option></select></label>
      ${areas.length ? `<label><span>영역</span><select data-category-area><option value="">전체</option>${areaOptions}</select></label>` : ""}
    </div>
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
