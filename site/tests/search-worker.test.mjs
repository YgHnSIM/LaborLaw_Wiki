import assert from "node:assert/strict";
import test from "node:test";
import { createSearchMessageHandler } from "../assets/search-worker.js";

const documents = [
  {
    title: "통상임금",
    aliases: [],
    category: "concepts",
    status: "active",
    legalArea: "근로기준",
    sourceType: "",
    legalStatus: "current",
    asOfDate: "2026-07-15",
    updated: "2026-07-15",
    sourceId: "",
    publisher: "",
    metadata: "",
    excerpt: "통상임금 판단기준",
    body: "통상임금은 법정수당 산정의 기준이다.",
    officialSourceCount: 2
  },
  {
    title: "평균임금",
    aliases: [],
    category: "concepts",
    status: "active",
    legalArea: "근로기준",
    sourceType: "",
    legalStatus: "current",
    asOfDate: "2026-07-14",
    updated: "2026-07-14",
    sourceId: "",
    publisher: "",
    metadata: "",
    excerpt: "평균임금 판단기준",
    body: "평균임금은 퇴직급여 산정에 사용된다.",
    officialSourceCount: 1
  }
];

test("검색 Worker가 초기화·요청 ID·결과 제한 프로토콜을 지킨다", async () => {
  const messages = [];
  const urls = [];
  const handleMessage = createSearchMessageHandler({
    loadIndex: async (url) => {
      urls.push(url);
      return documents;
    },
    postMessage: (message) => messages.push(message)
  });

  await handleMessage({ type: "search", id: 1, query: "임금", limit: 1 });
  assert.deepEqual(messages, []);

  await handleMessage({ type: "init", url: "/search.json" });
  await handleMessage({ type: "search", id: 7, query: "임금", filters: { category: "concepts" }, limit: 1 });

  assert.deepEqual(urls, ["/search.json"]);
  assert.deepEqual(messages[0], { type: "ready" });
  assert.equal(messages[1].type, "results");
  assert.equal(messages[1].id, 7);
  assert.equal(messages[1].total, 2);
  assert.deepEqual(messages[1].entries.map((entry) => entry.title), ["통상임금"]);
});

test("검색 Worker가 초기화 오류를 구조화된 메시지로 반환한다", async () => {
  const messages = [];
  const handleMessage = createSearchMessageHandler({
    loadIndex: async () => { throw new Error("색인 실패"); },
    postMessage: (message) => messages.push(message)
  });

  await handleMessage({ type: "init", url: "/search.json" });
  assert.deepEqual(messages, [{ type: "error", id: undefined, message: "색인 실패" }]);
});
