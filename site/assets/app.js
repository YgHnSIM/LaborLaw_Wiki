const root = document.documentElement;
const body = document.body;

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

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, " ")
    .trim();
}

function occurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let position = 0;
  while ((position = haystack.indexOf(needle, position)) >= 0) {
    count += 1;
    position += Math.max(needle.length, 1);
    if (count >= 8) break;
  }
  return count;
}

function scoreDocument(document, query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  const fields = {
    title: normalize(document.title),
    aliases: normalize(document.aliases.join(" ")),
    id: normalize(document.sourceId),
    publisher: normalize(document.publisher),
    metadata: normalize(document.metadata),
    excerpt: normalize(document.excerpt),
    body: normalize(document.body)
  };
  const combined = Object.values(fields).join(" ");
  if (!tokens.every((token) => combined.includes(token))) return -1;

  let score = 0;
  for (const token of tokens) {
    if (fields.title === token) score += 320;
    else if (fields.title.startsWith(token)) score += 210;
    else if (fields.title.includes(token)) score += 150;
    if (fields.aliases.includes(token)) score += 110;
    if (fields.id.includes(token)) score += 130;
    if (fields.publisher.includes(token)) score += 80;
    if (fields.metadata.includes(token)) score += 65;
    if (fields.excerpt.includes(token)) score += 38;
    score += Math.min(occurrences(fields.body, token) * 7, 42);
  }
  if (fields.title.includes(query)) score += 80;
  if (fields.aliases.includes(query)) score += 55;
  return score;
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

  link.append(number, content, meta);
  return link;
}

function setupSearch() {
  const dialog = document.querySelector("#search-dialog");
  const input = dialog?.querySelector("[data-search-input]");
  const results = dialog?.querySelector("[data-search-results]");
  const guidance = dialog?.querySelector("[data-search-guidance]");
  const categoryFilter = dialog?.querySelector("[data-search-category]");
  const statusFilter = dialog?.querySelector("[data-search-status]");
  const areaFilter = dialog?.querySelector("[data-search-area]");
  const openButtons = document.querySelectorAll("[data-search-open]");
  const closeButton = dialog?.querySelector("[data-search-close]");
  if (!dialog || !input || !results || !guidance || !categoryFilter || !statusFilter || !areaFilter) return;

  let documents = null;
  let loading = null;
  let selectedIndex = -1;
  let debounceTimer = null;
  let visibleLimit = 12;

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

  const updateSelection = (nextIndex) => {
    const links = [...results.querySelectorAll(".search-result")];
    if (!links.length) return;
    selectedIndex = Math.max(0, Math.min(nextIndex, links.length - 1));
    links.forEach((link, index) => link.classList.toggle("is-selected", index === selectedIndex));
    links[selectedIndex].scrollIntoView({ block: "nearest" });
  };

  const syncUrl = () => {
    const url = new URL(window.location.href);
    const values = {
      q: input.value.trim(),
      category: categoryFilter.value,
      status: statusFilter.value,
      area: areaFilter.value
    };
    for (const [key, value] of Object.entries(values)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const render = async () => {
    const query = normalize(input.value);
    const tokens = query.split(/\s+/).filter(Boolean);
    selectedIndex = -1;
    results.replaceChildren();
    const hasFilters = categoryFilter.value || statusFilter.value || areaFilter.value;
    if (!query && !hasFilters) {
      guidance.textContent = "제목·별칭·본문·사건번호·출처 ID를 검색합니다.";
      syncUrl();
      return;
    }

    guidance.textContent = "검색 중…";
    try {
      const index = await loadIndex();
      const matches = index
        .filter((entry) => !categoryFilter.value || entry.category === categoryFilter.value)
        .filter((entry) => !statusFilter.value || entry.status === statusFilter.value)
        .filter((entry) => !areaFilter.value || entry.legalArea === areaFilter.value)
        .map((entry) => ({ entry, score: query ? scoreDocument(entry, query) : 0 }))
        .filter((match) => match.score >= 0)
        .sort((a, b) => b.score - a.score || b.entry.updated.localeCompare(a.entry.updated) || a.entry.title.localeCompare(b.entry.title, "ko"));
      guidance.textContent = `검색 결과 ${matches.length}개 · ${Math.min(visibleLimit, matches.length)}개 표시`;
      if (!matches.length) {
        const empty = document.createElement("p");
        empty.className = "search-empty";
        empty.textContent = "일치하는 문서가 없습니다. 더 짧은 검색어나 사건번호 일부를 입력해 보세요.";
        results.append(empty);
        return;
      }
      const fragment = document.createDocumentFragment();
      matches.slice(0, visibleLimit).forEach(({ entry }, indexNumber) => fragment.append(createResult(entry, indexNumber, tokens)));
      if (matches.length > visibleLimit) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "search-more";
        more.textContent = `${Math.min(12, matches.length - visibleLimit)}개 더 보기`;
        more.addEventListener("click", () => {
          visibleLimit += 12;
          render();
        });
        fragment.append(more);
      }
      results.append(fragment);
      syncUrl();
    } catch (error) {
      guidance.textContent = "검색 색인을 불러오지 못했습니다.";
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "페이지를 새로고침한 뒤 다시 시도해 주세요.";
      results.append(empty);
      console.error(error);
    }
  };

  const open = (preset = {}) => {
    if (preset.area !== undefined) areaFilter.value = preset.area;
    if (preset.status !== undefined) statusFilter.value = preset.status;
    if (preset.category !== undefined) categoryFilter.value = preset.category;
    visibleLimit = 12;
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => input.focus(), 0);
    loadIndex().then(() => render()).catch(() => {});
  };

  const close = () => {
    if (dialog.open) dialog.close();
  };

  openButtons.forEach((button) => button.addEventListener("click", () => open({
    area: button.dataset.searchPresetArea,
    status: button.dataset.searchPresetStatus,
    category: button.dataset.searchPresetCategory
  })));
  closeButton?.addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  input.addEventListener("input", () => {
    window.clearTimeout(debounceTimer);
    visibleLimit = 12;
    debounceTimer = window.setTimeout(render, 90);
  });
  [categoryFilter, statusFilter, areaFilter].forEach((filter) => filter.addEventListener("change", () => {
    visibleLimit = 12;
    render();
  }));
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
  categoryFilter.value = url.searchParams.get("category") || "";
  statusFilter.value = url.searchParams.get("status") || "";
  areaFilter.value = url.searchParams.get("area") || "";
  if (input.value || categoryFilter.value || statusFilter.value || areaFilter.value) open();
}

function setupCategoryFilters() {
  const controls = document.querySelector("[data-category-filters]");
  const cards = [...document.querySelectorAll("[data-document-card]")];
  if (!controls || !cards.length) return;
  const status = controls.querySelector("[data-category-status]");
  const area = controls.querySelector("[data-category-area]");
  const count = controls.querySelector("[data-category-count]");
  const apply = () => {
    let visible = 0;
    for (const card of cards) {
      const show = (!status?.value || card.dataset.status === status.value) && (!area?.value || card.dataset.area === area.value);
      card.hidden = !show;
      if (show) visible += 1;
    }
    if (count) count.textContent = String(visible);
  };
  status?.addEventListener("change", apply);
  area?.addEventListener("change", apply);
}

function setupReadingCoordinates() {
  const headings = [...document.querySelectorAll(".prose h2, .prose h3")];
  const tocLinks = [...document.querySelectorAll("[data-toc-link]")];
  const railIndex = document.querySelector("[data-rail-index]");
  const railTitle = document.querySelector("[data-rail-title]");
  const mobileTitle = document.querySelector("[data-mobile-toc-current]");
  const mobileToc = document.querySelector("[data-mobile-toc]");
  const progress = document.querySelector("[data-reading-progress]");
  const article = document.querySelector(".prose");
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
    const updateProgress = () => {
      const top = article.offsetTop;
      const distance = Math.max(article.offsetHeight - window.innerHeight * 0.65, 1);
      const value = Math.max(0, Math.min(100, ((window.scrollY - top) / distance) * 100));
      progress.value = value;
      progress.setAttribute("aria-valuetext", `${Math.round(value)}% 읽음`);
      scheduled = false;
    };
    const scheduleProgress = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(updateProgress);
    };
    window.addEventListener("scroll", scheduleProgress, { passive: true });
    window.addEventListener("resize", scheduleProgress);
    updateProgress();
  }
}

setupMobileMenu();
setupSearch();
setupCategoryFilters();
setupReadingCoordinates();
