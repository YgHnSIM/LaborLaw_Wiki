import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesSearchFilters,
  normalizeSearchText,
  scoreDocument,
  searchDocuments
} from "../assets/search-core.js";

function searchEntry(overrides = {}) {
  return {
    title: "기본 문서",
    aliases: [],
    category: "concepts",
    status: "active",
    legalArea: "",
    sourceType: "",
    legalStatus: "",
    asOfDate: "",
    effectiveDate: "",
    decisionDate: "",
    updated: "2026-01-01",
    sourceId: "",
    publisher: "",
    metadata: "",
    excerpt: "",
    body: "",
    officialSourceCount: 0,
    ...overrides
  };
}

test("검색어를 NFKC·소문자·단일 공백으로 정규화한다", () => {
  assert.equal(normalizeSearchText("  ＳＲＣ－１２３\t노 동 법  "), "src-123 노 동 법");
  assert.equal(normalizeSearchText(null), "");
});

test("제목 완전일치와 별칭을 본문 일치보다 우선한다", () => {
  const exact = searchEntry({ title: "통상임금", updated: "2024-01-01" });
  const alias = searchEntry({ title: "임금 산정", aliases: ["통상임금"], updated: "2025-01-01" });
  const body = searchEntry({ title: "법정수당", body: "법정수당 계산에서는 통상임금을 확인한다.", updated: "2026-01-01" });
  const unrelated = searchEntry({ title: "산업재해", updated: "2026-07-01" });

  assert.ok(scoreDocument(exact, "통상임금") > scoreDocument(alias, "통상임금"));
  assert.ok(scoreDocument(alias, "통상임금") > scoreDocument(body, "통상임금"));
  assert.equal(scoreDocument(unrelated, "통상임금"), -1);

  const result = searchDocuments([body, unrelated, alias, exact], "  통상임금  ", {}, 10);
  assert.equal(result.total, 3);
  assert.deepEqual(result.entries.map((entry) => entry.title), ["통상임금", "임금 산정", "법정수당"]);
});

test("분류·상태·영역·자료·법적 상태·날짜 필터를 함께 적용한다", () => {
  const target = searchEntry({
    title: "필터 대상",
    category: "analyses",
    status: "review",
    legalArea: "집단노동",
    sourceType: "official_decision",
    legalStatus: "current",
    asOfDate: "2026-07-15"
  });
  const other = searchEntry({
    title: "다른 문서",
    category: "concepts",
    status: "active",
    legalArea: "근로기준",
    sourceType: "news",
    legalStatus: "amended"
  });
  const filters = {
    category: "analyses",
    status: "review",
    area: "집단노동",
    sourceType: "official_decision",
    legalStatus: "current",
    dateKind: "asOfDate"
  };

  assert.equal(matchesSearchFilters(target, filters), true);
  assert.equal(matchesSearchFilters(other, filters), false);
  assert.deepEqual(searchDocuments([other, target], "", filters, 10).entries, [target]);
});

test("점수가 같으면 기준일·수정일 내림차순과 한국어 제목순으로 정렬한다", () => {
  const older = searchEntry({ title: "다 문서", asOfDate: "2025-12-31", updated: "2026-07-15" });
  const sameDateLaterTitle = searchEntry({ title: "나 문서", asOfDate: "2026-07-15" });
  const sameDateEarlierTitle = searchEntry({ title: "가 문서", asOfDate: "2026-07-15" });
  const inputs = [older, sameDateLaterTitle, sameDateEarlierTitle];

  const result = searchDocuments(inputs, "", {}, 2);
  assert.equal(result.total, 3);
  assert.deepEqual(result.entries.map((entry) => entry.title), ["가 문서", "나 문서"]);
  assert.deepEqual(inputs.map((entry) => entry.title), ["다 문서", "나 문서", "가 문서"]);
  assert.equal(searchDocuments(inputs, "").entries.length, inputs.length);
});
