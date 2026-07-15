import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSourceCitations,
  extractWikiLinks,
  parseSourceCitation,
  parseWikiLink,
  replaceWikiLinks,
  stripSourceCitations
} from "../lib/wiki-syntax.mjs";

test("위키링크의 대상·섹션·표시명을 첫 구분자 기준으로 해석한다", () => {
  assert.deepEqual(parseWikiLink("[[근로시간#휴게#예외|표시|이름]]"), {
    raw: "[[근로시간#휴게#예외|표시|이름]]",
    target: "근로시간",
    section: "휴게#예외",
    label: "표시|이름"
  });
  assert.deepEqual(parseWikiLink("[[#관련 항목]]"), {
    raw: "[[#관련 항목]]",
    target: "",
    section: "관련 항목",
    label: ""
  });
});

test("위키링크 추출과 치환은 같은 파서를 공유한다", () => {
  const markdown = "[[근로시간]]과 [[휴게#판단기준|휴게 판단]], 그리고 [[잘못된\n링크]]";
  assert.deepEqual(extractWikiLinks(markdown), [
    { raw: "[[근로시간]]", target: "근로시간", section: "", label: "" },
    { raw: "[[휴게#판단기준|휴게 판단]]", target: "휴게", section: "판단기준", label: "휴게 판단" }
  ]);
  assert.equal(
    replaceWikiLinks(markdown, ({ target, section, label }) => label || (section && !target ? section : target)),
    "근로시간과 휴게 판단, 그리고 [[잘못된\n링크]]"
  );
  assert.equal(parseWikiLink("[[잘못된\n링크]]"), null);
});

test("근거 표식 추출과 제거가 동일한 문법을 사용한다", () => {
  const markdown = "주장 [@SRC-LAW-001] 반복 [@SRC-LAW-001] 잘못된 [@src-law-001]";
  assert.deepEqual(extractSourceCitations(markdown), ["SRC-LAW-001", "SRC-LAW-001"]);
  assert.deepEqual(parseSourceCitation("[@SRC-LAW-001] 뒤 문장"), {
    raw: "[@SRC-LAW-001]",
    sourceId: "SRC-LAW-001"
  });
  assert.equal(parseSourceCitation("앞 문장 [@SRC-LAW-001]"), null);
  assert.equal(stripSourceCitations(markdown), "주장   반복   잘못된 [@src-law-001]");
});
