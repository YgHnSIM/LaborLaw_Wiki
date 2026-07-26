// Compatibility export for integrations that imported the old module.  The
// authoritative data now lives in wiki/data/research-issues.json and is loaded
// by loadWiki(), so the web build and Python checks share one editable source.
export const RESEARCH_ISSUES = [];

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

export function resolveResearchIssues(pages, lookup, researchConfig, normalizeLookup) {
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
