import assert from "node:assert/strict";
import { test } from "node:test";
import { RESEARCH_ISSUES, resolveResearchIssues } from "../lib/research-issues.mjs";
import { normalizeLookup } from "../lib/wiki.mjs";

function syntheticPage({ title, route, category, status = "active", sourceType = "" }) {
  return {
    route,
    category,
    data: {
      title,
      status,
      source_type: sourceType
    },
    sourcePages: [],
    citedBy: [],
    researchIssueMemberships: [],
    researchIssueIds: []
  };
}

function membershipShape(memberships) {
  return memberships.map(({ issue, stageIds }) => ({
    issueId: issue.id,
    stageIds: [...stageIds]
  }));
}

test("합성 문서의 쟁점·단계와 인용 출처 귀속을 해소한다", () => {
  assert.deepEqual(RESEARCH_ISSUES, [], "기존 호환 export를 유지한다");

  const officialSource = syntheticPage({
    title: "공식 판정",
    route: "/sources/official/",
    category: "sources",
    sourceType: "official_decision"
  });
  const supportingSource = syntheticPage({
    title: "보조 해설",
    route: "/sources/commentary/",
    category: "sources",
    sourceType: "practitioner_commentary"
  });
  const concept = syntheticPage({
    title: "합성 개념",
    route: "/concepts/synthetic/",
    category: "concepts"
  });
  const analysis = syntheticPage({
    title: "합성 분석",
    route: "/analyses/synthetic/",
    category: "analyses",
    status: "review"
  });

  concept.sourcePages = [officialSource, supportingSource];
  analysis.sourcePages = [officialSource];
  officialSource.citedBy = [analysis, concept];
  supportingSource.citedBy = [concept];

  const pages = [concept, analysis, officialSource, supportingSource];
  const lookup = new Map([
    [normalizeLookup(concept.data.title), concept],
    [normalizeLookup(analysis.data.title), analysis]
  ]);
  const researchConfig = {
    issues: [{
      id: "synthetic-issue",
      question: "합성 쟁점은 어떻게 연결되는가?",
      description: "단계와 출처 역귀속을 검증하는 합성 쟁점",
      stages: [
        { id: "basis", label: "기초", pageRefs: [concept.data.title] },
        { id: "comparison", label: "비교", pageRefs: [analysis.data.title, concept.data.title] }
      ]
    }]
  };

  const { researchIssues, researchIssueMemberships } = resolveResearchIssues(
    pages,
    lookup,
    researchConfig,
    normalizeLookup
  );

  assert.equal(researchIssues.length, 1);
  const [issue] = researchIssues;
  assert.deepEqual(issue.pages, [concept, analysis]);
  assert.equal(issue.primaryPage, concept);
  assert.equal(issue.documentCount, 2);
  assert.equal(issue.analysisCount, 1);
  assert.equal(issue.officialSourceCount, 1);
  assert.equal(issue.reviewCount, 1);

  assert.deepEqual(membershipShape(researchIssueMemberships.get(concept.route)), [{
    issueId: "synthetic-issue",
    stageIds: ["basis", "comparison"]
  }]);
  assert.deepEqual(membershipShape(researchIssueMemberships.get(analysis.route)), [{
    issueId: "synthetic-issue",
    stageIds: ["comparison"]
  }]);
  assert.deepEqual(membershipShape(researchIssueMemberships.get(officialSource.route)), [{
    issueId: "synthetic-issue",
    stageIds: ["basis", "comparison"]
  }]);
  assert.deepEqual(concept.researchIssueIds, ["synthetic-issue"]);
  assert.equal(concept.researchIssueMemberships, researchIssueMemberships.get(concept.route));
});

test("합성 쟁점의 해소되지 않는 문서 참조를 거부한다", () => {
  const page = syntheticPage({
    title: "존재하는 문서",
    route: "/concepts/existing/",
    category: "concepts"
  });
  const lookup = new Map([[normalizeLookup(page.data.title), page]]);
  const researchConfig = {
    issues: [{
      id: "missing-reference",
      question: "누락 참조인가?",
      description: "오류 경로 검증",
      stages: [{ id: "missing", label: "누락", pageRefs: ["없는 문서"] }]
    }]
  };

  assert.throws(
    () => resolveResearchIssues([page], lookup, researchConfig, normalizeLookup),
    /research issue missing-reference\/missing: 존재하지 않는 페이지 제목·별칭·파일명 없는 문서/
  );
});
