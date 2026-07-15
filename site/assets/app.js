import { normalizeSearchText as normalize, searchDocuments } from "./search-core.js";

const root = document.documentElement;
const body = document.body;

function setupBodyFontPicker() {
  const select = document.querySelector("[data-body-font-select]");
  if (!select) return;
  select.value = root.dataset.bodyFont;
  select.addEventListener("change", () => {
    root.dataset.bodyFont = select.value;
    try { localStorage.setItem("laborlaw-body-font", select.value); } catch {}
  });
}

function setupMobileMenu() {
  const toggle = document.querySelector("[data-menu-toggle]");
  const sidebar = document.querySelector("#sidebar");
  const pageFrame = document.querySelector(".page-frame");
  const topbar = document.querySelector(".topbar");
  const closeButtons = document.querySelectorAll("[data-menu-close]");
  if (!toggle || !sidebar) return;
  const mobile = window.matchMedia("(max-width: 58rem)");

  const setOpen = (open) => {
    const mobileOpen = mobile.matches && open;
    body.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    sidebar.inert = mobile.matches && !mobileOpen;
    if (mobile.matches && !mobileOpen) sidebar.setAttribute("aria-hidden", "true");
    else sidebar.removeAttribute("aria-hidden");
    if (pageFrame) pageFrame.inert = mobileOpen;
    if (topbar) topbar.inert = mobileOpen;
    if (mobileOpen) sidebar.querySelector("a, button")?.focus();
    else if (open) body.classList.remove("menu-open");
    else toggle.focus({ preventScroll: true });
  };

  toggle.addEventListener("click", () => setOpen(!body.classList.contains("menu-open")));
  closeButtons.forEach((button) => button.addEventListener("click", () => setOpen(false)));
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a") && window.matchMedia("(max-width: 58rem)").matches) setOpen(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && body.classList.contains("menu-open")) setOpen(false);
  });
  mobile.addEventListener("change", () => setOpen(false));
  sidebar.inert = mobile.matches;
  if (mobile.matches) sidebar.setAttribute("aria-hidden", "true");
}

function appendHighlightedText(target, value, tokens) {
  const text = String(value ?? "");
  const usefulTokens = [...new Set(tokens.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!usefulTokens.length) {
    target.textContent = text;
    return;
  }
  const escaped = usefulTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "giu");
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > position) target.append(document.createTextNode(text.slice(position, match.index)));
    const mark = document.createElement("mark");
    mark.textContent = match[0];
    target.append(mark);
    position = match.index + match[0].length;
  }
  if (position < text.length) target.append(document.createTextNode(text.slice(position)));
}

function resultSnippet(entry, tokens) {
  const excerpt = String(entry.excerpt || "");
  if (!tokens.length || tokens.some((token) => normalize(excerpt).includes(token))) return excerpt || "요약이 없는 문서입니다.";
  const body = String(entry.body || "");
  const normalizedBody = normalize(body);
  const first = tokens.map((token) => normalizedBody.indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return excerpt || "요약이 없는 문서입니다.";
  const start = Math.max(0, first - 55);
  const end = Math.min(body.length, start + 190);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
}

function createResult(entry, index, tokens) {
  const link = document.createElement("a");
  link.className = "search-result";
  link.href = entry.url;
  link.id = `search-result-${index}`;
  link.setAttribute("role", "option");
  link.setAttribute("aria-selected", "false");
  link.tabIndex = -1;

  const number = document.createElement("span");
  number.className = "search-result-index";
  number.textContent = String(index + 1).padStart(2, "0");

  const content = window.document.createElement("div");
  const title = window.document.createElement("h3");
  appendHighlightedText(title, entry.title, tokens);
  const excerpt = window.document.createElement("p");
  appendHighlightedText(excerpt, resultSnippet(entry, tokens), tokens);
  content.append(title, excerpt);

  const meta = window.document.createElement("div");
  meta.className = "search-result-meta";
  const category = window.document.createElement("span");
  category.textContent = entry.categoryLabel;
  const status = window.document.createElement("span");
  status.textContent = entry.statusLabel;
  meta.append(category, status);
  if (entry.legalArea) {
    const area = window.document.createElement("span");
    area.textContent = entry.legalArea;
    meta.append(area);
  }
  const referenceDate = entry.asOfDate || entry.effectiveDate || entry.decisionDate;
  if (referenceDate) {
    const date = window.document.createElement("span");
    date.textContent = `${entry.asOfDate ? "기준" : entry.effectiveDate ? "시행" : "결정"} ${referenceDate.replaceAll("-", ".")}`;
    meta.append(date);
  }

  link.append(number, content, meta);
  return link;
}

function setupSearch() {
  const dialog = document.querySelector("#search-dialog");
  const input = dialog?.querySelector("[data-search-input]");
  const results = dialog?.querySelector("[data-search-results]");
  const guidance = dialog?.querySelector("#search-guidance");
  const statusText = dialog?.querySelector("[data-search-status-text]");
  const filterPanel = dialog?.querySelector("[data-search-filter-panel]");
  const filterToggle = dialog?.querySelector("[data-search-filter-toggle]");
  const filterSummary = dialog?.querySelector("[data-search-filter-summary]");
  const filterReset = dialog?.querySelector("[data-search-filter-reset]");
  const filterDone = dialog?.querySelector("[data-search-filter-done]");
  const categoryFilter = dialog?.querySelector("[data-search-category]");
  const statusFilter = dialog?.querySelector("[data-search-status]");
  const areaFilter = dialog?.querySelector("[data-search-area]");
  const sourceTypeFilter = dialog?.querySelector("[data-search-source-type]");
  const legalStatusFilter = dialog?.querySelector("[data-search-legal-status]");
  const dateKindFilter = dialog?.querySelector("[data-search-date-kind]");
  const openButtons = document.querySelectorAll("[data-search-open]");
  const closeButton = dialog?.querySelector("[data-search-close]");
  if (!dialog || !input || !results || !guidance || !statusText || !filterPanel || !filterToggle || !filterSummary || !filterReset || !filterDone || !categoryFilter || !statusFilter || !areaFilter || !sourceTypeFilter || !legalStatusFilter || !dateKindFilter) return;

  const filterControls = [categoryFilter, statusFilter, areaFilter, sourceTypeFilter, legalStatusFilter, dateKindFilter];
  const mobileFilterMedia = window.matchMedia("(max-width: 38rem)");

  let documents = null;
  let loading = null;
  let selectedIndex = -1;
  let debounceTimer = null;
  let visibleLimit = 12;
  let renderRequest = 0;
  let worker = null;
  let workerReady = null;
  let workerRequest = 0;
  let workerSupported = "Worker" in window;
  const workerPending = new Map();

  const initializeWorker = () => {
    if (!workerSupported || worker) return;
    worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
    let resolveReady;
    let rejectReady;
    workerReady = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    worker.addEventListener("message", (event) => {
      const message = event.data ?? {};
      if (message.type === "ready") {
        resolveReady();
      } else if (message.type === "results") {
        workerPending.get(message.id)?.resolve(message);
        workerPending.delete(message.id);
      } else if (message.type === "error") {
        const error = new Error(message.message || "검색 작업자 오류");
        if (message.id) {
          workerPending.get(message.id)?.reject(error);
          workerPending.delete(message.id);
        } else {
          rejectReady(error);
        }
      }
    });
    worker.addEventListener("error", (event) => {
      workerSupported = false;
      rejectReady(event.error || new Error("검색 작업자를 시작하지 못했습니다."));
    }, { once: true });
    worker.postMessage({ type: "init", url: dialog.dataset.searchUrl });
  };

  const loadIndex = async () => {
    if (documents) return documents;
    if (!loading) {
      loading = fetch(dialog.dataset.searchUrl, { credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) throw new Error(`검색 색인 요청 실패: ${response.status}`);
          return response.json();
        })
        .then((data) => {
          documents = data;
          return documents;
        });
    }
    return loading;
  };

  const filters = () => ({
    category: categoryFilter.value,
    status: statusFilter.value,
    area: areaFilter.value,
    sourceType: sourceTypeFilter.value,
    legalStatus: legalStatusFilter.value,
    dateKind: dateKindFilter.value
  });

  const filterIsOpen = () => filterToggle.getAttribute("aria-expanded") === "true";

  const syncFilterOverlayState = () => {
    const blocksResults = filterIsOpen() && mobileFilterMedia.matches;
    results.inert = blocksResults;
    if (blocksResults) {
      results.setAttribute("aria-hidden", "true");
      input.setAttribute("aria-expanded", "false");
    } else {
      results.removeAttribute("aria-hidden");
      if (results.querySelector(".search-result")) input.setAttribute("aria-expanded", "true");
    }
  };

  const setFilterOpen = (open, { focusToggle = false } = {}) => {
    filterToggle.setAttribute("aria-expanded", String(open));
    filterPanel.hidden = !open;
    syncFilterOverlayState();
    if (!open && focusToggle) filterToggle.focus();
  };

  const syncFilterUi = () => {
    const activeCount = filterControls.filter((filter) => filter.value).length;
    filterSummary.textContent = String(activeCount);
    filterToggle.setAttribute("aria-label", activeCount ? `필터, ${activeCount}개 적용` : "필터, 적용 없음");
    filterToggle.classList.toggle("has-active-filters", activeCount > 0);
    filterReset.disabled = activeCount === 0;
  };

  const searchIndex = async (query, activeFilters, limit) => {
    initializeWorker();
    if (worker && workerReady) {
      try {
        await workerReady;
        const id = ++workerRequest;
        return await new Promise((resolve, reject) => {
          workerPending.set(id, { resolve, reject });
          worker.postMessage({ type: "search", id, query, filters: activeFilters, limit });
        });
      } catch (error) {
        console.warn("검색 작업자를 사용할 수 없어 기본 검색으로 전환합니다.", error);
        worker.terminate();
        workerSupported = false;
        worker = null;
        workerReady = null;
      }
    }
    const index = await loadIndex();
    return searchDocuments(index, query, activeFilters, limit);
  };

  const updateSelection = (nextIndex) => {
    const links = [...results.querySelectorAll(".search-result")];
    if (!links.length) {
      selectedIndex = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    selectedIndex = (nextIndex + links.length) % links.length;
    links.forEach((link, index) => {
      const selected = index === selectedIndex;
      link.classList.toggle("is-selected", selected);
      link.setAttribute("aria-selected", String(selected));
    });
    input.setAttribute("aria-activedescendant", links[selectedIndex].id);
    links[selectedIndex].scrollIntoView({ block: "nearest" });
  };

  const syncUrl = () => {
    const url = new URL(window.location.href);
    const values = {
      q: input.value.trim(),
      "search-category": categoryFilter.value,
      "search-status": statusFilter.value,
      "search-area": areaFilter.value,
      "search-source": sourceTypeFilter.value,
      "search-legal": legalStatusFilter.value,
      "search-date": dateKindFilter.value
    };
    const hasSearch = Object.values(values).some(Boolean);
    if (hasSearch) url.searchParams.set("search", "1");
    else url.searchParams.delete("search");
    for (const [key, value] of Object.entries(values)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const render = async () => {
    const query = normalize(input.value);
    const tokens = query.split(/\s+/).filter(Boolean);
    const currentRequest = ++renderRequest;
    selectedIndex = -1;
    input.removeAttribute("aria-activedescendant");
    input.setAttribute("aria-expanded", "false");
    results.replaceChildren();
    const activeFilters = filters();
    const hasFilters = Object.values(activeFilters).some(Boolean);
    syncFilterUi();
    if (!query && !hasFilters) {
      guidance.textContent = "제목 완전일치와 별칭을 우선해 본문·사건번호·출처 ID까지 검색합니다.";
      statusText.textContent = "";
      filterDone.textContent = "결과 보기";
      syncUrl();
      return;
    }

    guidance.textContent = "검색 중…";
    statusText.textContent = "검색 중입니다.";
    filterDone.textContent = "검색 중…";
    try {
      const matches = await searchIndex(query, activeFilters, visibleLimit);
      if (currentRequest !== renderRequest) return;
      const shown = Math.min(visibleLimit, matches.total);
      guidance.textContent = `검색 결과 ${matches.total}개 · ${shown}개 표시`;
      statusText.textContent = `검색 결과 ${matches.total}개 중 ${shown}개를 표시합니다.`;
      filterDone.textContent = `${matches.total}개 결과 보기`;
      if (!matches.total) {
        const empty = document.createElement("p");
        empty.className = "search-empty";
        empty.textContent = "일치하는 문서가 없습니다. 더 짧은 검색어나 사건번호 일부를 입력해 보세요.";
        results.append(empty);
        syncUrl();
        return;
      }
      const fragment = document.createDocumentFragment();
      matches.entries.forEach((entry, indexNumber) => fragment.append(createResult(entry, indexNumber, tokens)));
      if (matches.total > visibleLimit) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "search-more";
        more.textContent = `${Math.min(12, matches.total - visibleLimit)}개 더 보기`;
        more.addEventListener("click", () => {
          visibleLimit += 12;
          render();
        });
        fragment.append(more);
      }
      results.append(fragment);
      input.setAttribute("aria-expanded", "true");
      syncFilterOverlayState();
      syncUrl();
    } catch (error) {
      guidance.textContent = "검색 색인을 불러오지 못했습니다.";
      statusText.textContent = "검색 색인을 불러오지 못했습니다.";
      filterDone.textContent = "결과 보기";
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "페이지를 새로고침한 뒤 다시 시도해 주세요.";
      results.append(empty);
      console.error(error);
    }
  };

  const open = (preset = {}) => {
    const hasPreset = Object.values(preset).some((value) => value !== undefined);
    if (hasPreset) {
      input.value = "";
      categoryFilter.value = "";
      statusFilter.value = "";
      areaFilter.value = "";
      sourceTypeFilter.value = "";
      legalStatusFilter.value = "";
      dateKindFilter.value = "";
    }
    if (preset.query !== undefined) input.value = preset.query;
    if (preset.area !== undefined) areaFilter.value = preset.area;
    if (preset.status !== undefined) statusFilter.value = preset.status;
    if (preset.category !== undefined) categoryFilter.value = preset.category;
    visibleLimit = 12;
    setFilterOpen(false);
    syncFilterUi();
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => input.focus(), 0);
    render();
  };

  const close = () => {
    setFilterOpen(false);
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    if (dialog.open) dialog.close();
  };

  openButtons.forEach((button) => button.addEventListener("click", () => open({
    query: button.dataset.searchPresetQuery,
    area: button.dataset.searchPresetArea,
    status: button.dataset.searchPresetStatus,
    category: button.dataset.searchPresetCategory
  })));
  closeButton?.addEventListener("click", close);
  filterToggle.addEventListener("click", () => setFilterOpen(!filterIsOpen()));
  filterDone.addEventListener("click", () => setFilterOpen(false, { focusToggle: true }));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  input.addEventListener("input", () => {
    window.clearTimeout(debounceTimer);
    visibleLimit = 12;
    debounceTimer = window.setTimeout(render, 90);
  });
  filterControls.forEach((filter) => filter.addEventListener("change", () => {
    visibleLimit = 12;
    syncFilterUi();
    render();
  }));
  filterReset.addEventListener("click", () => {
    filterControls.forEach((filter) => { filter.value = ""; });
    visibleLimit = 12;
    setFilterOpen(false);
    syncFilterUi();
    render();
    input.focus();
  });
  dialog.addEventListener("cancel", (event) => {
    if (!filterIsOpen()) return;
    event.preventDefault();
    setFilterOpen(false, { focusToggle: true });
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateSelection(selectedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateSelection(selectedIndex - 1);
    } else if (event.key === "Enter" && selectedIndex >= 0) {
      event.preventDefault();
      results.querySelectorAll(".search-result")[selectedIndex]?.click();
    }
  });
  dialog.addEventListener("close", () => {
    setFilterOpen(false);
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  });
  mobileFilterMedia.addEventListener?.("change", syncFilterOverlayState);
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "k") {
      event.preventDefault();
      open();
    } else if (event.key === "/" && !typing && !dialog.open) {
      event.preventDefault();
      open();
    }
  });

  const url = new URL(window.location.href);
  input.value = url.searchParams.get("q") || "";
  categoryFilter.value = url.searchParams.get("search-category") || "";
  statusFilter.value = url.searchParams.get("search-status") || "";
  areaFilter.value = url.searchParams.get("search-area") || "";
  sourceTypeFilter.value = url.searchParams.get("search-source") || "";
  legalStatusFilter.value = url.searchParams.get("search-legal") || "";
  dateKindFilter.value = url.searchParams.get("search-date") || "";
  syncFilterUi();
  if (url.searchParams.get("search") === "1" || input.value || categoryFilter.value || statusFilter.value || areaFilter.value || sourceTypeFilter.value || legalStatusFilter.value || dateKindFilter.value) open();
}

function setupCategoryFilters() {
  const controls = document.querySelector("[data-category-filters]");
  const cards = [...document.querySelectorAll("[data-document-card]")];
  if (!controls || !cards.length) return;
  const status = controls.querySelector("[data-category-status]");
  const area = controls.querySelector("[data-category-area]");
  const count = controls.querySelector("[data-category-count]");
  const syncUrl = () => {
    const url = new URL(window.location.href);
    if (status?.value) url.searchParams.set("status", status.value);
    else url.searchParams.delete("status");
    if (area?.value) url.searchParams.set("area", area.value);
    else url.searchParams.delete("area");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const apply = (updateUrl = true) => {
    let visible = 0;
    for (const card of cards) {
      const show = (!status?.value || card.dataset.status === status.value) && (!area?.value || card.dataset.area === area.value);
      card.hidden = !show;
      if (show) visible += 1;
    }
    if (count) count.textContent = String(visible);
    if (updateUrl) syncUrl();
  };
  status?.addEventListener("change", apply);
  area?.addEventListener("change", apply);
  const url = new URL(window.location.href);
  const initialStatus = url.searchParams.get("status") || "";
  const initialArea = url.searchParams.get("area") || "";
  if (status && [...status.options].some((option) => option.value === initialStatus)) status.value = initialStatus;
  if (area && [...area.options].some((option) => option.value === initialArea)) area.value = initialArea;
  apply(false);
}

function setupReadingCoordinates() {
  const article = document.querySelector("[data-reading-article]");
  if (!article) return;
  const headings = [...article.querySelectorAll("h2, h3")];
  const tocLinks = [...document.querySelectorAll("[data-toc-link]")];
  const railIndex = document.querySelector("[data-rail-index]");
  const railTitle = document.querySelector("[data-rail-title]");
  const mobileTitle = document.querySelector("[data-mobile-toc-current]");
  const mobileToc = document.querySelector("[data-mobile-toc]");
  const progress = document.querySelector("[data-reading-progress]");
  if (!headings.length) return;

  let h2Index = 0;
  headings.forEach((heading) => {
    if (heading.tagName === "H2") {
      h2Index += 1;
      heading.dataset.sectionNumber = String(h2Index).padStart(2, "0");
    }
  });

  const activate = (heading) => {
    const index = headings.indexOf(heading);
    const coordinate = String(index + 1).padStart(2, "0");
    if (railIndex) railIndex.textContent = coordinate;
    if (railTitle) railTitle.textContent = heading.textContent.trim();
    if (mobileTitle) mobileTitle.textContent = heading.textContent.trim();
    tocLinks.forEach((link) => {
      let fragment = link.hash.slice(1);
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        // Keep the browser-provided fragment when it is not valid percent encoding.
      }
      link.classList.toggle("is-current", fragment === heading.id);
    });
  };

  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) activate(visible[0].target);
  }, { rootMargin: "-18% 0px -68% 0px", threshold: [0, 1] });

  headings.forEach((heading) => observer.observe(heading));
  activate(headings[0]);

  mobileToc?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    mobileToc.open = false;
  }));
  mobileToc?.querySelector("[data-scroll-top]")?.addEventListener("click", () => {
    window.scrollTo(0, 0);
    mobileToc.open = false;
  });

  if (progress && article) {
    let scheduled = false;
    let articleTop = 0;
    let articleHeight = 1;
    const updateProgress = () => {
      const distance = Math.max(articleHeight - window.innerHeight * 0.65, 1);
      const value = Math.max(0, Math.min(100, ((window.scrollY - articleTop) / distance) * 100));
      progress.value = value;
      progress.setAttribute("aria-valuetext", `${Math.round(value)}% 읽음`);
      scheduled = false;
    };
    const scheduleProgress = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(updateProgress);
    };
    const measureArticle = () => {
      const rect = article.getBoundingClientRect();
      articleTop = rect.top + window.scrollY;
      articleHeight = rect.height;
      scheduleProgress();
    };
    window.addEventListener("scroll", scheduleProgress, { passive: true });
    window.addEventListener("resize", measureArticle);
    if ("ResizeObserver" in window) new ResizeObserver(measureArticle).observe(article);
    measureArticle();
  }
}

function setupOverflowTables() {
  const wrappers = [...document.querySelectorAll("[data-table-scroll]")];
  if (!wrappers.length) return;
  const update = (wrapper) => {
    const overflow = wrapper.scrollWidth > wrapper.clientWidth + 1;
    wrapper.classList.toggle("is-overflowing", overflow);
    wrapper.classList.toggle("is-at-end", !overflow || wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 2);
    wrapper.tabIndex = overflow ? 0 : -1;
    if (overflow) {
      wrapper.setAttribute("role", "region");
      wrapper.setAttribute("aria-label", "표, 가로로 스크롤할 수 있습니다");
    } else {
      wrapper.removeAttribute("role");
      wrapper.removeAttribute("aria-label");
    }
  };
  wrappers.forEach((wrapper) => {
    wrapper.addEventListener("scroll", () => update(wrapper), { passive: true });
    update(wrapper);
  });
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver((entries) => entries.forEach((entry) => update(entry.target)));
    wrappers.forEach((wrapper) => observer.observe(wrapper));
  }
}

function setupEvidenceCitations() {
  const revealTarget = (hash = window.location.hash) => {
    if (!hash.startsWith("#evidence-")) return;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the fragment as supplied when it is not valid percent encoding.
    }
    const target = document.getElementById(id);
    const panel = target?.closest("details.evidence-panel");
    if (panel) panel.open = true;
  };

  document.querySelectorAll(".evidence-citation").forEach((citation) => {
    citation.addEventListener("click", () => revealTarget(citation.hash));
  });
  window.addEventListener("hashchange", () => revealTarget());
  revealTarget();
}

setupBodyFontPicker();
setupMobileMenu();
setupSearch();
setupCategoryFilters();
setupOverflowTables();
setupEvidenceCitations();
if ("requestIdleCallback" in window) window.requestIdleCallback(setupReadingCoordinates, { timeout: 700 });
else window.setTimeout(setupReadingCoordinates, 0);
