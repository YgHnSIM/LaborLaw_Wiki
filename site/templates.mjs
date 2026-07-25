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

function pageStatusTone(status) {
  if (status === "active") return "current";
  if (status === "review") return "review";
  if (status === "draft" || status === "archived") return "muted";
  return "warning";
}

function legalStatusTone(status) {
  if (status === "current") return "current";
  if (status === "uncertain") return "warning";
  return "muted";
}

function pageStatusBadge(page) {
  return `<span class="status-badge status-${escapeAttr(page.data.status)} status-tone-${pageStatusTone(page.data.status)}">${escapeHtml(statusLabel(page.data.status))}</span>`;
}

function legalStatusBadge(page) {
  if (!page.data.legal_status) return "";
  return `<span class="legal-status legal-status-${escapeAttr(page.data.legal_status)} status-tone-${legalStatusTone(page.data.legal_status)}">${escapeHtml(legalStatusLabel(page.data.legal_status))}</span>`;
}

function renderReaderSettings() {
  return `<section class="reader-settings" aria-label="읽기 설정">
    <label for="body-font-select">본문 글꼴</label>
    <select id="body-font-select" data-body-font-select>
      <option value="ridibatang">리디바탕</option>
      <option value="maruburi">마루부리</option>
      <option value="system">시스템 바탕</option>
      <option value="d2coding">D2Coding</option>
    </select>
    <small>이 브라우저에 저장</small>
  </section>`;
}

function renderTopbar({ basePath, repositoryUrl, currentPage, currentCategory }) {
  const primary = ["concepts", "analyses", "entities", "sources"]
    .map((category) => {
      const current = currentCategory === category ? ' aria-current="page"' : "";
      return `<a href="${siteHref(basePath, `/${category}/`)}"${current}>${escapeHtml(CATEGORY_META[category].shortLabel)}</a>`;
    })
    .join("");
  const catalogCurrent = currentPage?.route === "/catalog/" ? ' aria-current="page"' : "";
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="${siteHref(basePath, "/")}" aria-label="대한민국 노동법 위키 홈">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>대한민국 노동법 위키</span>
        </a>
        <nav class="topnav" aria-label="전역 탐색">${primary}<a href="${siteHref(basePath, "/catalog/")}"${catalogCurrent}>전체 색인</a></nav>
        <div class="top-actions">
          <a class="repository-link" href="${escapeAttr(repositoryUrl)}" target="_blank" rel="noopener noreferrer">GitHub 저장소 ${svgIcon("external")}</a>
          <button class="search-trigger" type="button" data-search-open aria-haspopup="dialog" aria-label="문서 검색">
            ${svgIcon("search")}<span>검색</span><kbd>Ctrl K</kbd>
          </button>
          <details class="reading-menu">
            <summary aria-label="본문 글꼴 설정"><span aria-hidden="true">Aa</span><span>글꼴</span></summary>
            ${renderReaderSettings()}
          </details>
          <button class="menu-trigger" type="button" data-menu-toggle aria-controls="sidebar" aria-expanded="false" aria-label="문서 메뉴">
            ${svgIcon("menu")}<span>메뉴</span>
          </button>
        </div>
      </div>
    </header>`;
}

function renderGlobalMenu({ currentPage, currentCategory, basePath }) {
  const homeActive = currentPage?.route === "/" ? " is-active" : "";
  const catalogActive = currentPage?.route === "/catalog/" ? " is-active" : "";
  const groups = CATEGORY_ORDER.map((category) => {
    const meta = CATEGORY_META[category];
    const current = currentCategory === category;
    return `<li class="global-menu-group${current ? " is-current" : ""}">
      <a href="${siteHref(basePath, `/${category}/`)}"${current ? ' aria-current="page"' : ""}>
        <span>${escapeHtml(meta.shortLabel)}</span>
      </a>
    </li>`;
  }).join("");
  return `
    <aside class="global-menu" id="sidebar" aria-label="전역 탐색">
      <div class="global-menu-head">
        <span>전역 탐색</span>
        <button type="button" class="sidebar-close" data-menu-close>${svgIcon("close")}<span class="sr-only">메뉴 닫기</span></button>
      </div>
      <nav aria-label="전체 문서 탐색">
        <ul class="global-menu-shortcuts">
          <li><a class="${homeActive.trim()}" href="${siteHref(basePath, "/")}"><span>개요</span></a></li>
          <li><a class="${catalogActive.trim()}" href="${siteHref(basePath, "/catalog/")}"><span>전체 색인</span></a></li>
        </ul>
        <ol class="global-menu-groups">${groups}</ol>
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
        <div class="search-head-title"><h2 id="search-dialog-title">문서 검색</h2></div>
        <button type="button" class="dialog-close" data-search-close aria-label="검색 닫기">${svgIcon("close")}<span>닫기</span></button>
      </div>
      <label class="search-field">
        <span class="sr-only">검색어</span>
        ${svgIcon("search")}
        <input id="search-input" type="search" role="combobox" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false" aria-describedby="search-guidance search-status" autocomplete="off" spellcheck="false" placeholder="개념, 사건번호, 출처 ID 검색" data-search-input>
      </label>
      <div class="search-command-bar">
        <p class="search-guidance" id="search-guidance">제목 완전일치와 별칭을 우선해 본문·사건번호·출처 ID까지 검색합니다.</p>
        <button type="button" class="search-filter-toggle" data-search-filter-toggle aria-expanded="false" aria-controls="search-filter-sheet" aria-label="필터, 적용 없음"><span>필터</span><strong data-search-filter-summary>0</strong></button>
      </div>
      <div class="search-controls-region" data-search-controls>
        <div class="search-active-filters" data-search-active-filters aria-label="적용 중인 검색 필터" hidden></div>
        <section class="search-filter-sheet" id="search-filter-sheet" data-search-filter-panel aria-labelledby="search-filter-sheet-title" hidden>
          <header class="search-filter-sheet-head"><strong id="search-filter-sheet-title">필터 편집</strong></header>
          <div class="search-filters" aria-label="검색 필터">
            <label><span>분류</span><select data-search-category><option value="">전체</option>${categoryOptions}</select></label>
            <label><span>상태</span><select data-search-status><option value="">전체</option><option value="active">활성</option><option value="draft">초안</option><option value="review">검토</option><option value="archived">보관</option></select></label>
            <label><span>영역</span><select data-search-area><option value="">전체</option>${areaOptions}</select></label>
            <label><span>자료</span><select data-search-source-type><option value="">전체</option>${sourceTypeOptions}</select></label>
            <label><span>법적 상태</span><select data-search-legal-status><option value="">전체</option><option value="current">현행</option><option value="amended">개정됨</option><option value="repealed">폐지됨</option><option value="overruled">판례 변경</option><option value="superseded">대체됨</option><option value="uncertain">확인 필요</option></select></label>
            <label><span>날짜 정보</span><select data-search-date-kind><option value="">전체</option><option value="asOfDate">지식 기준일 있음</option><option value="effectiveDate">시행일 있음</option><option value="decisionDate">결정일 있음</option></select></label>
          </div>
          <div class="search-filter-actions">
            <button type="button" class="search-filter-reset" data-search-filter-reset disabled>필터 초기화</button>
            <button type="button" class="search-filter-done" data-search-filter-done>결과 보기</button>
          </div>
        </section>
        <p class="sr-only" id="search-status" role="status" aria-live="polite" aria-atomic="true" data-search-status-text></p>
      </div>
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
    return `<aside class="status-notice status-tone-review" role="note"><strong>검토 중</strong><span>이 문서는 확인이 필요한 쟁점 또는 모순 경고를 포함합니다.</span></aside>`;
  }
  if (page.data.status === "draft") {
    return `<aside class="status-notice status-tone-muted" role="note"><strong>초안</strong><span>이 문서는 구조 또는 근거를 보강 중입니다.</span></aside>`;
  }
  if (page.data.status === "archived") {
    return `<aside class="status-notice status-tone-muted" role="note"><strong>보관 문서</strong><span>현재 설명이 아니라 역사적 기록으로 유지되는 문서입니다.</span></aside>`;
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
  add("법적 상태", legalStatusBadge(page), "fact-legal-status");
  add("근거 확신", escapeHtml(confidenceLabel(page.data.confidence)));
  if (page.sourceCount) {
    const value = page.category === "sources"
      ? `${page.sourceCount}개 원문`
      : `${page.sourceCount}개${page.officialSourceCount ? ` · 공식 ${page.officialSourceCount}` : ""}`;
    add(page.category === "sources" ? "원문 기록" : "연결 근거", escapeHtml(value));
  }
  add("다음 검토", renderTime(page.data.next_review_date), "fact-review-date status-tone-review");
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
    <header><h2 id="source-record-title">출처 기록</h2></header>
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

function renderDocumentRail(page, toc, basePath) {
  return `<aside class="document-rail" aria-label="문서 정보와 목차">
    <div class="article-evidence-trust">${renderEvidenceStrip(page)}</div>
    ${renderToc(toc, basePath, page.route)}
  </aside>`;
}

function renderCompactDocumentMeta(page, toc, basePath) {
  return `<div class="document-compact-meta">
    <div class="article-evidence-trust">${renderEvidenceStrip(page)}</div>
    ${renderMobileToc(toc, basePath, page.route)}
  </div>`;
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
  return `<section class="research-search" aria-label="문서 검색">
    <button class="research-search-launch" type="button" data-search-open>${svgIcon("search")}<span>확인하려는 개념이나 사건번호를 입력하세요</span><kbd>/</kbd></button>
    <div class="research-search-suggestions"><span>바로 찾기</span>${suggestions.map((query) => `<button type="button" data-search-open data-search-preset-query="${escapeAttr(query)}">${escapeHtml(query)}</button>`).join("")}</div>
  </section>`;
}

function renderResearchMeta(wiki, basePath) {
  const documents = wiki.pages.filter((page) => page.category !== "meta").length;
  const facts = [
    ["지식 기준일", renderTime(wiki.stats.knowledgeAsOf || wiki.stats.latestContentUpdated)],
    ["문서", `<strong>${documents}</strong>개`],
    ["출처", `<a href="${siteHref(basePath, "/sources/")}"><strong>${wiki.stats.sources}</strong>개</a>`],
    ["검토 필요", `<button type="button" data-search-open data-search-preset-status="review"><strong>${wiki.stats.statuses.review ?? 0}</strong>개</button>`]
  ];
  return `<dl class="research-meta" aria-label="지식베이스 현황">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function renderIssueStage(stage, basePath) {
  const primary = stage.pages[0];
  return `<details class="research-stage" data-issue-stage>
    <summary><span>${escapeHtml(stage.label)}</span><strong>${primary ? escapeHtml(primary.data.title) : ""}</strong>${stage.pages.length > 1 ? `<small>+${stage.pages.length - 1}</small>` : ""}</summary>
    <ol>${stage.pages.map((page) => `<li><a href="${siteHref(basePath, page.route)}">${escapeHtml(page.data.title)}</a><span>${escapeHtml(CATEGORY_META[page.category].shortLabel)}</span></li>`).join("")}</ol>
  </details>`;
}

function renderResearchIssuePanel(issue, index, basePath) {
  const panelId = `issue-${issue.id}`;
  return `<section class="research-dossier-panel" id="${escapeAttr(panelId)}" role="tabpanel" aria-labelledby="issue-tab-${escapeAttr(issue.id)}" data-issue-panel data-issue-id="${escapeAttr(issue.id)}"${index ? " hidden" : ""}>
    <header><div><span>조사 경로</span><h2>${escapeHtml(issue.question)}</h2><p>${escapeHtml(issue.description)}</p></div><a href="${siteHref(basePath, issue.primaryPage.route)}">${escapeHtml(issue.primaryPage.data.title)}${svgIcon("arrow")}</a></header>
    <dl class="research-dossier-facts"><div><dt>문서</dt><dd>${issue.documentCount}</dd></div><div><dt>분석</dt><dd>${issue.analysisCount}</dd></div><div><dt>공식 근거</dt><dd>${issue.officialSourceCount}</dd></div><div><dt>검토</dt><dd>${issue.reviewCount}</dd></div></dl>
    <div class="research-dossier-stages">${issue.stages.map((stage) => renderIssueStage(stage, basePath)).join("")}</div>
  </section>`;
}

function renderResearchDesk(wiki, basePath) {
  const tabs = wiki.researchIssues.map((issue, index) => `<button id="issue-tab-${escapeAttr(issue.id)}" type="button" role="tab" aria-selected="${index === 0}" aria-controls="issue-${escapeAttr(issue.id)}" tabindex="${index === 0 ? "0" : "-1"}" data-issue-select data-issue-id="${escapeAttr(issue.id)}"><strong>${escapeHtml(issue.question)}</strong></button>`).join("");
  const mobileOptions = wiki.researchIssues.map((issue, index) => `<option value="${escapeAttr(issue.id)}"${index === 0 ? " selected" : ""}>${escapeHtml(issue.question)}</option>`).join("");
  return `<section class="research-desk" aria-label="쟁점별 조사 시작점">
    <div class="research-question-index"><p id="research-issue-label">확인하려는 질문</p><label class="research-issue-mobile-select"><span class="sr-only">확인하려는 질문</span><select data-issue-select-mobile aria-labelledby="research-issue-label">${mobileOptions}</select></label><div role="tablist" aria-labelledby="research-issue-label" aria-orientation="vertical" data-issue-tabs>${tabs}</div></div>
    <div class="research-dossier">${wiki.researchIssues.map((issue, index) => renderResearchIssuePanel(issue, index, basePath)).join("")}</div>
  </section>`;
}

function renderResearchWorkbench({ page, articleHtml, wiki, basePath }) {
  return `<section class="research-workbench" aria-label="노동법 리서치 데스크">
    <header class="research-workbench-head"><div class="research-workbench-copy"><p class="page-kicker">대한민국 노동법 리서치</p><h1>${escapeHtml(page.data.title)}</h1><p>${escapeHtml(page.excerpt)}</p></div>${renderHomeSearch(basePath)}</header>
    ${renderResearchDesk(wiki, basePath)}
    ${renderResearchMeta(wiki, basePath)}
    <details class="home-about"><summary>위키 기준과 운영 현황 자세히 보기</summary><article class="prose home-description">${articleHtml}</article></details>
  </section>`;
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
    <meta name="theme-color" content="#2547D0">
    ${noindex ? '<meta name="robots" content="noindex,follow">' : ""}
    <link rel="canonical" href="${escapeAttr(canonical)}">
    <link rel="icon" href="${siteHref(basePath, "/assets/favicon.svg")}" type="image/svg+xml">
    <link rel="manifest" href="${siteHref(basePath, "/manifest.webmanifest")}">
    <link rel="sitemap" type="application/xml" href="${siteHref(basePath, "/sitemap.xml")}">
    <script>try { const value = localStorage.getItem("laborlaw-body-font"); if (["ridibatang", "maruburi", "system", "d2coding"].includes(value)) document.documentElement.dataset.bodyFont = value; } catch {}</script>
    <link rel="stylesheet" href="${siteHref(basePath, "/assets/styles.css")}">
    <meta property="og:type" content="${page ? "article" : "website"}">
    <meta property="og:locale" content="ko_KR">
    <meta property="og:site_name" content="${escapeAttr(siteName)}">
    <meta property="og:title" content="${escapeAttr(title)}">
    <meta property="og:description" content="${escapeAttr(description)}">
    <meta property="og:url" content="${escapeAttr(canonical)}">
    ${structuredData}`;
}

function renderShell({ wiki, page = null, currentCategory, title, description, canonical, main, basePath, repositoryUrl, siteUrl, pageKind = "page", noindex = false }) {
  const siteName = "대한민국 노동법 위키";
  return `<!doctype html>
<html lang="ko" data-base-path="${escapeAttr(basePath)}" data-design="legal-editorial" data-body-font="ridibatang">
  <head>${renderHead({ title, description, canonical, basePath, page, siteName, siteUrl, pageKind, noindex })}</head>
  <body>
    <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
    ${renderTopbar({ basePath, repositoryUrl, currentPage: page, currentCategory })}
    ${renderGlobalMenu({ currentPage: page, currentCategory, basePath })}
    <div class="page-frame">${main}${renderFooter({ basePath, stats: wiki.stats })}</div>
    ${renderSearchDialog(basePath)}
    <script type="module" src="${siteHref(basePath, "/assets/app.js")}"></script>
  </body>
</html>`;
}

export function renderPage({ page, rendered, wiki, basePath, siteUrl, repositoryUrl, repositoryRef }) {
  const category = CATEGORY_META[page.category];
  const isHome = page.route === "/";
  const canonical = absoluteUrl(siteUrl, page.route);
  const articleHtml = rendered.contentHtml;
  const aliases = page.data.aliases.length ? `<dl class="aliases"><dt>다른 이름</dt><dd>${page.data.aliases.map((alias) => `<span>${escapeHtml(alias)}</span>`).join("")}</dd></dl>` : "";
  const breadcrumbs = isHome ? "" : `<nav class="breadcrumbs" aria-label="현재 위치"><a href="${siteHref(basePath, "/")}">홈</a><span aria-hidden="true">/</span><a href="${siteHref(basePath, `/${page.category}/`)}">${escapeHtml(category.shortLabel)}</a></nav>`;
  const toc = isHome ? [] : rendered.toc;
  const statusNotice = renderStatusNotice(page);
  const heroMeta = statusNotice || aliases ? `<div class="article-hero-meta document-status-row">${statusNotice}${aliases}</div>` : "";
  const hero = `<header class="article-hero">
      <p class="page-kicker">${escapeHtml(category.label)}</p>
      <h1>${escapeHtml(page.data.title)}</h1>
      ${heroMeta}
    </header>`;
  const main = isHome
    ? `<main id="main-content" class="main-content main-content--home">${renderResearchWorkbench({ page, articleHtml, wiki, basePath })}</main>`
    : `<main id="main-content" class="main-content main-content--document">
      <div class="document-shell">
        ${breadcrumbs}
        ${hero}
        ${renderSourceRecord(page, { basePath, repositoryUrl, repositoryRef })}
        ${renderCompactDocumentMeta(page, toc, basePath)}
        <div class="article-layout">
          <article class="prose"${toc.length ? " data-reading-article" : ""}>${articleHtml}</article>
          ${renderDocumentRail(page, toc, basePath)}
        </div>
        <div class="document-followups">
          ${renderEvidencePanel(page, basePath)}
          ${renderCitedBy(page, basePath)}
          ${renderPrevNext(page, wiki, basePath)}
        </div>
      </div>
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
  });
}

export function renderCategoryPage({ category, wiki, basePath, siteUrl, repositoryUrl }) {
  const meta = CATEGORY_META[category];
  const pages = [...wiki.groups[category]].sort((a, b) => collator.compare(a.data.title, b.data.title));
  const areas = [...new Set(pages.map((page) => page.data.legal_area).filter(Boolean))].sort((a, b) => collator.compare(a, b));
  const cards = pages.map((page) => `<li data-document-card data-status="${escapeAttr(page.data.status)}" data-area="${escapeAttr(page.data.legal_area || "")}">
    <a href="${siteHref(basePath, page.route)}">
      <div class="document-card-copy"><h2>${escapeHtml(page.data.title)}</h2><p>${escapeHtml(page.excerpt)}</p></div>
      <footer>${pageStatusBadge(page)}<span>${page.category === "sources" ? "원문" : "근거"} ${page.sourceCount}</span><span>${page.data.as_of_date ? `기준 ${escapeHtml(displayDate(page.data.as_of_date))}` : `수정 ${escapeHtml(displayDate(page.data.updated))}`}</span></footer>
    </a>
  </li>`).join("");
  const areaOptions = areas.map((area) => `<option value="${escapeAttr(area)}">${escapeHtml(area)}</option>`).join("");
  const route = `/${category}/`;
  const listTitleId = `category-list-${escapeAttr(category)}`;
  const main = `<main id="main-content" class="main-content main-content--category category-main">
    <div class="category-shell">
      <nav class="breadcrumbs" aria-label="현재 위치"><a href="${siteHref(basePath, "/")}">홈</a><span>/</span><span>${escapeHtml(meta.shortLabel)}</span></nav>
      <header class="category-hero"><div><h1>${escapeHtml(meta.shortLabel)}</h1><p>${escapeHtml(meta.description)}</p></div></header>
      <form class="category-controls" data-category-filters aria-label="${escapeAttr(meta.shortLabel)} 문서 필터">
        <p class="category-result-count" role="status" aria-live="polite" aria-atomic="true"><strong data-category-count>${pages.length}</strong>개 문서 표시</p>
        <fieldset class="category-filter-fields">
          <legend class="sr-only">문서 필터</legend>
          <label><span>상태</span><select data-category-status><option value="">전체</option><option value="active">활성</option><option value="draft">초안</option><option value="review">검토</option><option value="archived">보관</option></select></label>
          ${areas.length ? `<label><span>영역</span><select data-category-area><option value="">전체</option>${areaOptions}</select></label>` : ""}
        </fieldset>
      </form>
      <section class="document-list" aria-labelledby="${listTitleId}">
        <h2 id="${listTitleId}" class="sr-only">${escapeHtml(meta.shortLabel)} 문서 목록</h2>
        <ol class="document-grid">${cards}</ol>
      </section>
    </div>
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
    pageKind: "collection"
  });
}

export function renderCatalogPage({ page, wiki, basePath, siteUrl, repositoryUrl }) {
  const catalogCategory = (candidate) => candidate.route === "/" ? "home" : candidate.category;
  const catalogCategories = [
    { id: "home", label: "홈", anchor: "홈" },
    { id: "meta", label: CATEGORY_META.meta.shortLabel, anchor: "메타" },
    { id: "sources", label: CATEGORY_META.sources.shortLabel, anchor: "소스" },
    { id: "concepts", label: CATEGORY_META.concepts.shortLabel, anchor: "개념" },
    { id: "entities", label: CATEGORY_META.entities.shortLabel, anchor: "개체" },
    { id: "analyses", label: CATEGORY_META.analyses.shortLabel, anchor: "분석" }
  ];
  const categoryRank = new Map(catalogCategories.map(({ id }, index) => [id, index]));
  const pages = wiki.pages
    .filter((candidate) => candidate.route !== page.route)
    .sort((left, right) => categoryRank.get(catalogCategory(left)) - categoryRank.get(catalogCategory(right)) || collator.compare(left.data.title, right.data.title));
  const areas = [...new Set(pages.map((candidate) => candidate.data.legal_area).filter(Boolean))].sort((left, right) => collator.compare(left, right));
  const categoryLabel = (candidate) => catalogCategories.find(({ id }) => id === catalogCategory(candidate)).label;
  const renderCard = (candidate) => `<li data-catalog-card data-category="${escapeAttr(catalogCategory(candidate))}" data-status="${escapeAttr(candidate.data.status)}" data-area="${escapeAttr(candidate.data.legal_area || "")}">
    <a href="${siteHref(basePath, candidate.route)}">
      <div class="document-card-copy"><h3>${escapeHtml(candidate.data.title)}</h3><p>${escapeHtml(candidate.excerpt)}</p></div>
      <footer><span class="document-category">${escapeHtml(categoryLabel(candidate))}</span>${pageStatusBadge(candidate)}<span>${candidate.category === "sources" ? "원문" : "근거"} ${candidate.sourceCount}</span><span>${candidate.data.as_of_date ? `기준 ${escapeHtml(displayDate(candidate.data.as_of_date))}` : `수정 ${escapeHtml(displayDate(candidate.data.updated))}`}</span></footer>
    </a>
  </li>`;
  const groups = catalogCategories.map((category) => ({
    ...category,
    pages: pages.filter((candidate) => catalogCategory(candidate) === category.id)
  })).filter((group) => group.pages.length);
  const groupLists = groups.map((group) => `<section class="document-list catalog-group" data-catalog-group data-catalog-group-category="${escapeAttr(group.id)}" aria-labelledby="${escapeAttr(group.anchor)}">
        <header class="catalog-group-head"><h2 id="${escapeAttr(group.anchor)}">${escapeHtml(group.label)}</h2></header>
        <ol class="document-grid catalog-document-grid">${group.pages.map(renderCard).join("")}</ol>
      </section>`).join("");
  const categoryOptions = catalogCategories.map(({ id, label }) => `<option value="${escapeAttr(id)}">${escapeHtml(label)}</option>`).join("");
  const areaOptions = areas.map((area) => `<option value="${escapeAttr(area)}">${escapeHtml(area)}</option>`).join("");
  const main = `<main id="main-content" class="main-content main-content--category category-main catalog-main">
    <div class="category-shell">
      <nav class="breadcrumbs" aria-label="현재 위치"><a href="${siteHref(basePath, "/")}">홈</a><span>/</span><span>전체 색인</span></nav>
      <header class="category-hero"><div><h1>${escapeHtml(page.data.title)}</h1><p>전체 문서를 분류, 상태, 영역으로 찾아봅니다.</p></div></header>
      <form class="category-controls" data-catalog-filters aria-label="전체 색인 문서 필터">
        <p class="category-result-count" role="status" aria-live="polite" aria-atomic="true"><strong data-catalog-count>${pages.length}</strong>개 문서 표시</p>
        <fieldset class="category-filter-fields">
          <legend class="sr-only">전체 색인 문서 필터</legend>
          <label><span>분류</span><select data-catalog-category><option value="">전체</option>${categoryOptions}</select></label>
          <label><span>상태</span><select data-catalog-status><option value="">전체</option><option value="active">활성</option><option value="draft">초안</option><option value="review">검토</option><option value="archived">보관</option></select></label>
          ${areas.length ? `<label><span>영역</span><select data-catalog-area><option value="">전체</option>${areaOptions}</select></label>` : ""}
        </fieldset>
      </form>
      ${groupLists}
      <nav class="catalog-related" id="관련-항목" aria-label="관련 항목"><a href="${siteHref(basePath, "/")}">홈</a><a href="${siteHref(basePath, "/log/")}">작업 기록</a></nav>
    </div>
  </main>`;
  return renderShell({
    wiki,
    page,
    currentCategory: null,
    title: page.data.title,
    description: "대한민국 노동법 위키 전체 문서를 분류, 상태, 영역으로 탐색합니다.",
    canonical: absoluteUrl(siteUrl, page.route),
    main,
    basePath,
    repositoryUrl,
    siteUrl,
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
    pageKind: "not-found",
    noindex: true
  });
}
