import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { extractWikiLinks, replaceWikiLinks, stripSourceCitations } from "./wiki-syntax.mjs";

export { extractWikiLinks };

export const CATEGORY_ORDER = ["concepts", "analyses", "entities", "cases", "sources", "meta"];

export const CATEGORY_META = {
  concepts: { label: "개념", shortLabel: "개념", number: "01", description: "조문과 판단기준, 노동법의 핵심 개념" },
  analyses: { label: "분석", shortLabel: "분석", number: "02", description: "판례·행정해석·입법과정의 비교와 해설" },
  entities: { label: "개체", shortLabel: "기관·단체", number: "03", description: "법원, 위원회, 행정기관과 주요 당사자" },
  cases: { label: "사건", shortLabel: "사건", number: "04", description: "원하청 교섭과 노동위원회 사건의 진행·판정 기록" },
  sources: { label: "출처", shortLabel: "출처", number: "05", description: "법령·판례·행정자료와 원문 계보" },
  meta: { label: "운영", shortLabel: "운영", number: "06", description: "전체 색인, 작업 기록과 관리 방법론" }
};

const STATUS_LABELS = {
  active: "활성",
  draft: "초안",
  review: "검토",
  archived: "보관"
};

const SOURCE_TYPE_LABELS = {
  official_law: "공식 법령",
  official_decision: "공식 결정",
  official_guidance: "공식 지침",
  official_record: "공식 기록",
  legal_excerpt: "법률 발췌",
  academic_paper: "학술논문",
  research_report: "연구보고서",
  news: "기사",
  practitioner_commentary: "실무 해설",
  llm_report: "LLM 보고서",
  stakeholder_statement: "이해관계자 성명"
};

const LEGAL_STATUS_LABELS = {
  current: "현행",
  amended: "개정됨",
  repealed: "폐지됨",
  overruled: "판례 변경",
  superseded: "대체됨",
  uncertain: "확인 필요"
};

const CONFIDENCE_LABELS = {
  high: "높음",
  medium: "보통",
  low: "낮음"
};

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? String(status ?? "");
}

export function sourceTypeLabel(sourceType) {
  return SOURCE_TYPE_LABELS[sourceType] ?? String(sourceType ?? "");
}

export function legalStatusLabel(status) {
  return LEGAL_STATUS_LABELS[status] ?? String(status ?? "");
}

export function recordStatusLabel(status) {
  return { available: "확인 가능", superseded: "대체됨", withdrawn: "철회됨", retracted: "철회·정정" }[status] ?? String(status ?? "");
}

export function normativeStatusLabel(status) {
  return { current: "현행", amended: "개정됨", repealed: "폐지됨", overruled: "판례 변경", uncertain: "확인 필요" }[status] ?? String(status ?? "");
}

export function confidenceLabel(confidence) {
  return CONFIDENCE_LABELS[confidence] ?? String(confidence ?? "");
}

export function normalizeLookup(value) {
  return String(value ?? "").normalize("NFC").trim().toLocaleLowerCase("ko-KR");
}

export function normalizeBasePath(value = "/") {
  const trimmed = String(value || "/").trim();
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const collapsed = withLeading.replace(/\/{2,}/g, "/");
  return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
}

export function encodeRoute(route) {
  const [pathname, fragment] = String(route).split("#", 2);
  const encoded = pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return fragment === undefined ? encoded : `${encoded}#${encodeURIComponent(fragment)}`;
}

export function siteHref(basePath, route = "/") {
  const base = normalizeBasePath(basePath);
  const relative = encodeRoute(route).replace(/^\//, "");
  return relative ? `${base}${relative}` : base;
}

export function slugifySegment(value) {
  return String(value)
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[\\/:*?"<>|#%]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function pageRoute(relativePath, data) {
  const parsed = path.posix.parse(relativePath.replaceAll("\\", "/"));
  const stem = parsed.name;
  const directory = parsed.dir;

  if (relativePath === "overview.md") return "/";
  if (relativePath === "index.md") return "/catalog/";
  if (relativePath === "log.md") return "/log/";
  if (directory === "sources") {
    if (!data.source_id) throw new Error(`${relativePath}: source_id가 없습니다.`);
    return `/sources/${slugifySegment(data.source_id)}/`;
  }
  if (directory === "cases") {
    const caseId = data.case_id || stem;
    return `/cases/${slugifySegment(caseId)}/`;
  }

  const category = directory || "meta";
  const slug = slugifySegment(stem);
  if (!slug) throw new Error(`${relativePath}: URL 슬러그가 비어 있습니다.`);
  return `/${category}/${slug}/`;
}

export function outputPathForRoute(outputDir, route) {
  const pathname = String(route).split("#", 1)[0];
  const relative = pathname === "/" ? "" : pathname.replace(/^\/+|\/+$/g, "");
  return path.join(outputDir, relative, "index.html");
}

function stringifyScalar(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function normalizeFrontmatter(data) {
  const result = { ...data };
  const stringFields = [
    "title", "created", "updated", "status", "source_id", "source_type", "publisher",
    "retrieved", "publication_date", "publication_period", "decision_date", "effective_date",
    "as_of_date", "promulgation_date", "legal_area", "authority", "record_status", "normative_status", "confidence",
    "event_status", "next_review_date", "last_checked", "review_due", "version", "law_number", "case_id", "entity_id", "entity_type",
    "verification_status", "adjudicating_body", "review_reason", "summary", "publisher", "author"
  ];
  for (const field of stringFields) {
    if (field in result) result[field] = stringifyScalar(result[field]);
  }
  const listFields = [
    "aliases", "tags", "source_refs", "background_source_refs", "decision_source_refs", "raw_sources", "raw_sha256", "attachments",
    "source_urls", "case_numbers", "parties", "party_entity_refs", "issue_refs", "case_refs",
    "reported_decision_dates", "staged_effective_dates", "bill_numbers", "key_dates", "removed_raw_refs"
  ];
  for (const field of listFields) {
    result[field] = Array.isArray(result[field]) ? result[field].map(stringifyScalar) : [];
  }
  if (Array.isArray(result.case_decisions)) {
    result.case_decisions = result.case_decisions.map((entry) =>
      Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, stringifyScalar(value)]))
    );
  } else {
    result.case_decisions = [];
  }
  if (Array.isArray(result.source_relations)) {
    result.source_relations = result.source_relations.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {};
      return Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, stringifyScalar(value)]));
    });
  } else {
    result.source_relations = [];
  }
  // Runtime compatibility for consumers that still read legal_status.  The
  // committed v2 frontmatter never writes this legacy key.
  if (!("legal_status" in result)) result.legal_status = result.normative_status || result.record_status || "";
  return result;
}

export function parseFrontmatter(source, filePath = "문서") {
  const normalized = String(source).replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${filePath}: YAML 프론트매터를 찾을 수 없습니다.`);
  const parsed = YAML.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath}: 프론트매터가 매핑이 아닙니다.`);
  }
  return { data: normalizeFrontmatter(parsed), body: match[2] };
}

function removeLeadingH1(body, expectedTitle, filePath) {
  const trimmed = body.replace(/^\s+/, "");
  const match = trimmed.match(/^#\s+(.+?)\r?\n(?:\r?\n)?/);
  if (!match) throw new Error(`${filePath}: 본문 첫 H1을 찾을 수 없습니다.`);
  if (normalizeLookup(match[1]) !== normalizeLookup(expectedTitle)) {
    throw new Error(`${filePath}: H1과 title이 일치하지 않습니다.`);
  }
  return trimmed.slice(match[0].length);
}

function plainText(markdown) {
  return stripSourceCitations(replaceWikiLinks(markdown, ({ target, section, label }) =>
    label || (section && !target ? section : target)))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^>\s*\[![A-Z]+\]\s*/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~>|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptFromBody(body) {
  const blocks = body.split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(">") || trimmed.startsWith("|") || trimmed.startsWith("- ")) continue;
    const excerpt = plainText(trimmed);
    if (excerpt) return excerpt.length > 210 ? `${excerpt.slice(0, 207).trimEnd()}…` : excerpt;
  }
  return "";
}

function categoryFromRelativePath(relativePath) {
  const directory = path.posix.dirname(relativePath.replaceAll("\\", "/"));
  return directory === "." ? "meta" : directory.split("/")[0];
}

function sourceCount(data, category) {
  if (category === "sources") return data.raw_sources.length + data.source_urls.length;
  return data.source_refs.length;
}

function researchIssueError(issueId, stageId, message) {
  const location = stageId ? `${issueId}/${stageId}` : issueId;
  return new Error(`research issue ${location}: ${message}`);
}

function addResearchIssueMembership(membershipsByRoute, page, issue, stageIds) {
  const memberships = membershipsByRoute.get(page.route);
  if (!memberships) throw new Error(`research issue ${issue.id}: 알 수 없는 문서 경로 ${page.route}`);
  let membership = memberships.find((candidate) => candidate.issue === issue);
  if (!membership) {
    membership = { issue, stageIds: [] };
    memberships.push(membership);
  }
  for (const stageId of stageIds) {
    if (!membership.stageIds.includes(stageId)) membership.stageIds.push(stageId);
  }
}

function resolveResearchIssues(pages, lookup, researchConfig) {
  const issues = Array.isArray(researchConfig?.issues) ? researchConfig.issues : [];
  if (!issues.length) throw new Error("research issues: wiki/data/research-issues.json에 issues가 필요합니다.");

  const membershipsByRoute = new Map(pages.map((page) => [page.route, []]));
  const issueIds = new Set();
  const issueOrder = new Map();
  const resolvedIssues = [];

  for (const rawIssue of issues) {
    const issueId = String(rawIssue?.id ?? "");
    if (!/^[a-z][a-z0-9-]*$/.test(issueId)) {
      throw new Error(`research issues: 잘못된 안정 ID ${issueId || "(빈 값)"}`);
    }
    if (issueIds.has(issueId)) throw new Error(`research issues: 중복 ID ${issueId}`);
    if (!rawIssue.question || !rawIssue.description) {
      throw researchIssueError(issueId, "", "question과 description이 필요합니다.");
    }
    if (!Array.isArray(rawIssue.stages) || !rawIssue.stages.length) {
      throw researchIssueError(issueId, "", "하나 이상의 stage가 필요합니다.");
    }

    issueIds.add(issueId);
    const issue = {
      id: issueId,
      question: String(rawIssue.question),
      description: String(rawIssue.description),
      stages: [],
      pages: [],
      documentCount: 0,
      analysisCount: 0,
      officialSourceCount: 0,
      reviewCount: 0,
      primaryPage: null
    };
    const stageIds = new Set();
    const issueRoutes = new Set();

    for (const rawStage of rawIssue.stages) {
      const stageId = String(rawStage?.id ?? "");
      if (!/^[a-z][a-z0-9-]*$/.test(stageId)) {
        throw researchIssueError(issueId, stageId, "잘못된 stage ID입니다.");
      }
      if (stageIds.has(stageId)) throw researchIssueError(issueId, stageId, "stage ID가 중복됩니다.");
      if (!rawStage.label || !Array.isArray(rawStage.pageRefs) || !rawStage.pageRefs.length) {
        throw researchIssueError(issueId, stageId, "label과 하나 이상의 pageRefs가 필요합니다.");
      }
      stageIds.add(stageId);

      const stageTitleKeys = new Set();
      const stageRoutes = new Set();
      const stagePages = rawStage.pageRefs.map((pageRef) => {
        const title = String(pageRef ?? "");
        const normalizedTitle = normalizeLookup(title);
        if (!normalizedTitle || stageTitleKeys.has(normalizedTitle)) {
          throw researchIssueError(issueId, stageId, `중복되었거나 비어 있는 페이지 제목 ${title || "(빈 값)"}`);
        }
        stageTitleKeys.add(normalizedTitle);
        const page = lookup.get(normalizedTitle);
        if (!page) throw researchIssueError(issueId, stageId, `존재하지 않는 페이지 제목·별칭·파일명 ${title}`);
        if (stageRoutes.has(page.route)) {
          throw researchIssueError(issueId, stageId, `같은 페이지를 제목·별칭·파일명으로 중복 등록했습니다: ${title}`);
        }
        stageRoutes.add(page.route);
        if (page.category === "sources") {
          throw researchIssueError(issueId, stageId, `출처 페이지는 직접 등록할 수 없습니다: ${title}`);
        }
        return page;
      });

      issue.stages.push({ id: stageId, label: String(rawStage.label), pages: stagePages });
      for (const page of stagePages) {
        addResearchIssueMembership(membershipsByRoute, page, issue, [stageId]);
        if (!issueRoutes.has(page.route)) {
          issueRoutes.add(page.route);
          issue.pages.push(page);
        }
      }
    }

    if (!issue.pages.length) throw researchIssueError(issueId, "", "해결된 페이지가 없습니다.");
    const officialSources = new Set();
    for (const page of issue.pages) {
      for (const source of page.sourcePages) {
        if (source.data.source_type.startsWith("official_")) officialSources.add(source);
      }
    }
    issue.documentCount = issue.pages.length;
    issue.analysisCount = issue.pages.filter((page) => page.category === "analyses").length;
    issue.officialSourceCount = officialSources.size;
    issue.reviewCount = issue.pages.filter((page) => page.data.status === "review").length;
    issue.primaryPage = issue.pages[0];
    issueOrder.set(issue.id, resolvedIssues.length);
    resolvedIssues.push(issue);
  }

  for (const source of pages.filter((page) => page.category === "sources")) {
    const sourceMemberships = new Map();
    for (const citingPage of source.citedBy) {
      for (const membership of membershipsByRoute.get(citingPage.route) ?? []) {
        const stageIds = sourceMemberships.get(membership.issue) ?? new Set();
        membership.stageIds.forEach((stageId) => stageIds.add(stageId));
        sourceMemberships.set(membership.issue, stageIds);
      }
    }
    for (const [issue, sourceStageIds] of sourceMemberships) {
      const orderedStageIds = issue.stages
        .map((stage) => stage.id)
        .filter((stageId) => sourceStageIds.has(stageId));
      addResearchIssueMembership(membershipsByRoute, source, issue, orderedStageIds);
    }
  }

  for (const page of pages) {
    const memberships = membershipsByRoute.get(page.route);
    memberships.sort((left, right) => issueOrder.get(left.issue.id) - issueOrder.get(right.issue.id));
    for (const membership of memberships) {
      const stageOrder = new Map(membership.issue.stages.map((stage, index) => [stage.id, index]));
      membership.stageIds.sort((left, right) => stageOrder.get(left) - stageOrder.get(right));
    }
    page.researchIssueMemberships = memberships;
    page.researchIssueIds = memberships.map((membership) => membership.issue.id);
  }

  return { researchIssues: resolvedIssues, researchIssueMemberships: membershipsByRoute };
}

async function listMarkdownFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await listMarkdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(fullPath);
  }
  return results;
}

export async function loadWiki(rootDir) {
  const wikiDir = path.join(rootDir, "wiki");
  let researchConfig;
  try {
    researchConfig = JSON.parse(await fs.readFile(path.join(wikiDir, "data", "research-issues.json"), "utf8"));
  } catch (error) {
    throw new Error(`wiki/data/research-issues.json을 읽을 수 없습니다: ${error.message}`);
  }
  if (researchConfig.version !== 1 || !Array.isArray(researchConfig.issues) || !Array.isArray(researchConfig.search_suggestions)) {
    throw new Error("research-issues.json은 version, search_suggestions, issues를 제공해야 합니다.");
  }
  const files = (await listMarkdownFiles(wikiDir)).sort((a, b) => a.localeCompare(b, "ko"));
  const pages = [];

  for (const filePath of files) {
    const relativePath = path.relative(wikiDir, filePath).replaceAll("\\", "/");
    const raw = await fs.readFile(filePath, "utf8");
    const { data, body } = parseFrontmatter(raw, relativePath);
    if (!data.title) throw new Error(`${relativePath}: title이 없습니다.`);
    const category = categoryFromRelativePath(relativePath);
    if (!CATEGORY_META[category]) throw new Error(`${relativePath}: 알 수 없는 카테고리 ${category}`);
    const stem = path.posix.parse(relativePath).name;
    const route = pageRoute(relativePath, data);
    const bodyWithoutH1 = removeLeadingH1(body, data.title, relativePath);
    pages.push({
      filePath,
      relativePath,
      stem,
      category,
      route,
      data,
      body: bodyWithoutH1,
      rawBody: body,
      excerpt: excerptFromBody(bodyWithoutH1),
      searchText: plainText(bodyWithoutH1),
      sourceCount: sourceCount(data, category),
      wikiLinks: extractWikiLinks(bodyWithoutH1),
      sourcePages: [],
      officialSourceCount: 0,
      supportingSourceCount: 0,
      citedBy: [],
      relatedSources: [],
      supersedingSource: null,
      researchIssueIds: [],
      researchIssueMemberships: [],
      casePages: [],
      sourceRelations: []
    });
  }

  const routeSet = new Set();
  const lookup = new Map();
  const sourcesById = new Map();
  for (const page of pages) {
    if (routeSet.has(page.route)) throw new Error(`중복 URL: ${page.route}`);
    routeSet.add(page.route);
    const keys = [page.stem, page.data.title, ...page.data.aliases];
    for (const key of keys) {
      const normalized = normalizeLookup(key);
      const existing = lookup.get(normalized);
      if (existing && existing !== page) {
        throw new Error(`중복 제목/별칭: ${key} (${existing.relativePath}, ${page.relativePath})`);
      }
      lookup.set(normalized, page);
    }
    if (page.category === "sources") {
      if (sourcesById.has(page.data.source_id)) throw new Error(`중복 source_id: ${page.data.source_id}`);
      sourcesById.set(page.data.source_id, page);
    }
  }

  for (const page of pages) {
    page.sourcePages = (page.data.source_refs ?? []).map((id) => {
      const source = sourcesById.get(id);
      if (!source) throw new Error(`${page.relativePath}: 존재하지 않는 source_refs ${id}`);
      source.citedBy.push(page);
      return source;
    });
    page.officialSourceCount = page.sourcePages.filter((source) => source.data.source_type.startsWith("official_")).length;
    page.supportingSourceCount = page.sourcePages.length - page.officialSourceCount;
    page.sourceRelations = (page.data.source_relations ?? []).map((relation) => {
      const source = sourcesById.get(relation.target);
      if (!source) throw new Error(`${page.relativePath}: 존재하지 않는 source_relations target ${relation.target}`);
      return { ...relation, source };
    });
    page.relatedSources = page.sourceRelations
      .filter((relation) => ["same_matter", "updates", "interprets", "amends", "appeal_of"].includes(relation.type))
      .map((relation) => relation.source);
    page.supersedingSource = page.sourceRelations.find((relation) => relation.type === "supersedes")?.source ?? null;
    page.casePages = (page.data.case_refs ?? []).map((caseId) => {
      const candidate = pages.find((other) => other.category === "cases" && other.data.case_id === caseId);
      if (!candidate) throw new Error(`${page.relativePath}: 존재하지 않는 case_refs ${caseId}`);
      return candidate;
    });
    for (const link of page.wikiLinks) {
      if (!link.target) continue;
      if (!lookup.get(normalizeLookup(link.target))) {
        throw new Error(`${page.relativePath}: 해소되지 않는 위키링크 ${link.raw}`);
      }
    }
  }

  const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
  const groups = Object.fromEntries(CATEGORY_ORDER.map((category) => [
    category,
    pages.filter((page) => page.category === category).sort((a, b) => collator.compare(a.data.title, b.data.title))
  ]));
  for (const page of pages) {
    const byTitle = (a, b) => collator.compare(a.data.title, b.data.title);
    page.citedBy.sort(byTitle);
  }

  const { researchIssues, researchIssueMemberships } = resolveResearchIssues(pages, lookup, researchConfig);

  const statusCounts = pages.reduce((counts, page) => {
    counts[page.data.status] = (counts[page.data.status] ?? 0) + 1;
    return counts;
  }, {});
  const latestUpdated = pages.map((page) => page.data.updated).filter(Boolean).sort().at(-1) ?? "";
  const contentPages = pages.filter((page) => page.category !== "meta");
  const latestContentUpdated = contentPages.map((page) => page.data.updated).filter(Boolean).sort().at(-1) ?? "";
  const asOfDates = contentPages.map((page) => page.data.as_of_date).filter(Boolean).sort();
  const latestChecked = pages.map((page) => page.data.last_checked || page.data.as_of_date).filter(Boolean).sort().at(-1) ?? "";
  const asOfCoverage = contentPages.length ? Math.round((asOfDates.length / contentPages.length) * 100) : 0;
  const today = new Date().toISOString().slice(0, 10);
  const overduePages = pages.filter((page) => page.data.review_due && page.data.review_due < today);
  const freshnessByArea = Object.fromEntries([...new Set(contentPages.map((page) => page.data.legal_area).filter(Boolean))].sort().map((area) => {
    const areaPages = contentPages.filter((page) => page.data.legal_area === area);
    const areaDates = areaPages.map((page) => page.data.as_of_date).filter(Boolean).sort();
    return [area, { total: areaPages.length, covered: areaDates.length, latest: areaDates.at(-1) ?? "", overdue: areaPages.filter((page) => page.data.review_due && page.data.review_due < today).length }];
  }));

  return {
    pages,
    groups,
    lookup,
    researchIssues,
    researchIssueMemberships,
    sourcesById,
    stats: {
      pages: pages.length,
      sources: groups.sources.length,
      concepts: groups.concepts.length,
      analyses: groups.analyses.length,
      entities: groups.entities.length,
      cases: groups.cases.length,
      meta: groups.meta.length,
      statuses: statusCounts,
      latestUpdated,
      latestContentUpdated,
      knowledgeAsOf: asOfDates.length === contentPages.length ? asOfDates.at(-1) : "",
      latestChecked,
      asOfCoverage,
      overdueCount: overduePages.length,
      freshnessByArea,
      researchSuggestions: researchConfig.search_suggestions
    }
  };
}
