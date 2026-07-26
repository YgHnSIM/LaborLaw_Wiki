#!/usr/bin/env python3
"""One-shot migration from the v1 wiki frontmatter to schema v2.

The script is intentionally deterministic.  It never reads or writes ``raw/``;
source IDs are preserved, and all generated values are derived from the
existing page, source, or stable title hash.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WIKI = ROOT / "wiki"
sys.path.insert(0, str(ROOT / "scripts"))
from lint_wiki import parse_yaml_value  # noqa: E402


TYPE_BY_DIRECTORY = {
    "sources": "source",
    "concepts": "concept",
    "entities": "entity",
    "analyses": "analysis",
    "cases": "case",
    "meta": "meta",
}

SOURCE_TYPES = {
    "official_law", "official_decision", "official_guidance", "official_record",
    "legal_excerpt", "academic_paper", "research_report", "news",
    "practitioner_commentary", "llm_report", "stakeholder_statement",
}


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    lines = text.replace("\r\n", "\n").split("\n")
    if lines[0] != "---":
        raise ValueError("frontmatter delimiter missing")
    end = lines.index("---", 1)
    values: dict[str, object] = {}
    index = 1
    while index < end:
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            index += 1
            continue
        match = re.match(r"^([A-Za-z][A-Za-z0-9_]*):(?:[ \t]*(.*))?$", line)
        if not match:
            index += 1
            continue
        key, raw = match.group(1), match.group(2) or ""
        if raw.strip():
            values[key] = parse_yaml_value(raw.strip())
            index += 1
            continue
        child_values: list[object] = []
        cursor = index + 1
        while cursor < end and (not lines[cursor].strip() or lines[cursor].startswith((" ", "\t"))):
            child = lines[cursor]
            if child.lstrip().startswith("#") or not child.strip():
                cursor += 1
                continue
            item = re.match(r"^[ \t]+-[ \t]*(.*)$", child)
            if item:
                child_values.append(parse_yaml_value(item.group(1).strip()))
            cursor += 1
        values[key] = child_values
        index = cursor
    body = "\n".join(lines[end + 1 :]).lstrip("\n")
    return values, body


def yaml_scalar(value: object) -> str:
    if isinstance(value, str):
        if re.fullmatch(r"[A-Za-z0-9가-힣._/+\-·,() ]+", value) and not value.startswith(("[", "{")):
            return value
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    return str(value)


def yaml_value(value: object, *, key: str = "") -> list[str]:
    if isinstance(value, list):
        if not value:
            return [f"{key}: []"]
        if all(isinstance(item, dict) for item in value):
            return [f"{key}: {json.dumps(value, ensure_ascii=False)}"]
        if all(isinstance(item, str) and "\n" not in item for item in value):
            return [f"{key}: {json.dumps(value, ensure_ascii=False)}"]
        return [f"{key}:", *[f"  - {yaml_scalar(item)}" for item in value]]
    if isinstance(value, dict):
        return [f"{key}: {json.dumps(value, ensure_ascii=False)}"]
    return [f"{key}: {yaml_scalar(value)}"]


def dump_frontmatter(data: dict[str, object], body: str) -> str:
    lines = ["---"]
    order = [
        "title", "aliases", "tags", "created", "updated", "status", "summary",
        "source_id", "source_type", "publisher", "author", "reported_authority", "adjudicating_body",
        "raw_sources", "raw_sha256", "attachments", "source_urls", "retrieved", "source_relations",
        "record_status", "source_refs", "background_source_refs", "decision_source_refs",
        "case_id", "case_numbers", "parties", "party_entity_refs", "issue_refs", "event_status",
        "verification_status", "last_checked", "next_review_date", "review_due", "review_reason",
        "entity_id", "entity_type", "legal_area", "authority", "effective_date", "decision_date",
        "promulgation_date", "publication_date", "publication_period", "reported_decision_dates",
        "case_number", "case_decisions", "normative_status", "confidence", "process_type", "bill_numbers",
        "assembly_session", "committee", "key_dates", "law_number", "version", "staged_effective_dates",
        "related_official_url", "source_system", "removed_raw_refs", "case_refs",
    ]
    for key in order:
        if key in data:
            lines.extend(yaml_value(data[key], key=key))
    for key in sorted(set(data) - set(order)):
        lines.extend(yaml_value(data[key], key=key))
    lines.extend(["---", "", body.rstrip(), ""])
    return "\n".join(lines)


def title_hash(value: str, prefix: str) -> str:
    return f"{prefix}-{hashlib.sha1(value.encode('utf-8')).hexdigest()[:10].upper()}"


def first_summary(body: str, title: str) -> str:
    for block in re.split(r"\n\s*\n", body):
        clean = re.sub(r"^#{1,6}\s+.*$", "", block, flags=re.MULTILINE)
        clean = re.sub(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]", lambda m: m.group(2) or m.group(1), clean)
        clean = re.sub(r"\[@[^\]]+\]", "", clean)
        clean = re.sub(r"[*_`>|]", "", clean)
        clean = re.sub(r"\s+", " ", clean).strip(" -")
        if len(clean) >= 20:
            return clean[:197].rstrip() + ("…" if len(clean) > 197 else "")
    return f"{title}에 관한 노동법 지식과 원문 근거를 구조화한 위키 문서입니다."


def append_citation(body: str, source_id: str | None) -> str:
    if not source_id or re.search(r"\[@SRC-[A-Z0-9][A-Z0-9._-]{2,}(?:#(?:p|para|art)=[A-Za-z0-9._-]+)?\]", body):
        return body
    lines = body.splitlines()
    in_fence = False
    for index, line in enumerate(lines):
        if line.strip().startswith(("```", "~~~")):
            in_fence = not in_fence
            continue
        if in_fence or not line.strip() or line.lstrip().startswith(("#", ">", "- ", "* ", "|")):
            continue
        if "## 관련 항목" in line:
            continue
        lines[index] = f"{line.rstrip()} [@{source_id}]"
        return "\n".join(lines)
    return body


def map_record_status(value: object) -> str:
    return {"current": "available", "amended": "available", "superseded": "superseded", "uncertain": "available"}.get(str(value), "available")


def map_normative_status(value: object) -> str:
    return {"current": "current", "amended": "amended", "repealed": "repealed", "overruled": "overruled", "superseded": "uncertain", "uncertain": "uncertain"}.get(str(value), "uncertain")


def source_date(data: dict[str, object]) -> str:
    for key in ("decision_date", "publication_date", "retrieved", "updated"):
        value = data.get(key)
        if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return value
    period = data.get("publication_period")
    if isinstance(period, str) and re.fullmatch(r"\d{4}(?:-\d{2})?", period):
        return f"{period}-01" if len(period) == 7 else f"{period}-01-01"
    return ""


def migrate() -> None:
    pages: dict[str, tuple[Path, dict[str, object], str]] = {}
    for path in sorted(WIKI.rglob("*.md"), key=lambda p: p.as_posix().casefold()):
        data, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        pages[path.relative_to(WIKI).as_posix()] = (path, data, body)

    source_by_id = {str(data.get("source_id")): data for rel, (_, data, _) in pages.items() if rel.startswith("sources/") and data.get("source_id")}
    source_relations: dict[str, list[dict[str, str]]] = {
        source_id: [item for item in (data.get("source_relations") or []) if isinstance(item, dict)]
        for source_id, data in source_by_id.items()
    }
    for source_id, data in source_by_id.items():
        old_related = data.get("related_source_refs", []) or []
        if isinstance(old_related, list):
            for target in old_related:
                if isinstance(target, str) and target in source_by_id and target != source_id:
                    source_relations[source_id].append({"type": "same_matter", "target": target})
                    if not any(item.get("type") == "same_matter" and item.get("target") == source_id for item in source_relations[target]):
                        source_relations[target].append({"type": "same_matter", "target": source_id})
        target = data.get("superseded_by")
        if isinstance(target, str) and target in source_by_id and target != source_id:
            source_relations[source_id].append({"type": "supersedes", "target": target})
    for source_id, relations in source_relations.items():
        unique: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for relation in relations:
            relation_type, target = relation.get("type"), relation.get("target")
            identity = (str(relation_type), str(target))
            if relation_type in {"same_matter", "updates", "supersedes", "appeal_of", "interprets", "amends"} and target in source_by_id and identity not in seen:
                unique.append({"type": str(relation_type), "target": str(target)})
                seen.add(identity)
        source_relations[source_id] = unique

    entity_id_by_title: dict[str, str] = {}
    for rel, (_, data, _) in pages.items():
        if rel.startswith("entities/"):
            title = str(data.get("title", Path(rel).stem))
            entity_id_by_title[title] = title_hash(title, "ENT")

    for rel, (path, data, body) in pages.items():
        directory = rel.split("/", 1)[0] if "/" in rel else "meta"
        page_type = TYPE_BY_DIRECTORY.get(directory, "meta")
        title = str(data.get("title", path.stem))
        tags = [str(tag) for tag in (data.get("tags") or []) if isinstance(tag, str)]
        tags = [tag for tag in tags if not tag.startswith("type/")]
        tags.insert(0, f"type/{page_type}")
        data["tags"] = list(dict.fromkeys(tags))
        data["summary"] = first_summary(body, title)

        old_legal = data.pop("legal_status", None)
        data.pop("related_source_refs", None)
        old_superseded = data.pop("superseded_by", None)
        if page_type == "source":
            source_id = str(data.get("source_id", ""))
            data["source_relations"] = source_relations.get(source_id, [])
            data["record_status"] = map_record_status(old_legal)
            data.pop("event_status", None)
            if data.get("source_type") not in SOURCE_TYPES:
                data["source_type"] = "research_report"
        else:
            data.pop("next_review_date", None)
            if old_legal is not None:
                data["normative_status"] = map_normative_status(old_legal)
            if page_type in {"concept", "analysis", "entity"} and data.get("status") in {"active", "review"}:
                data["as_of_date"] = data.get("as_of_date") or data.get("updated")
                data["review_due"] = data.get("review_due") or "2026-08-26"
                data["review_reason"] = data.get("review_reason") or "정기 출처·법령 최신성 점검"
            if page_type == "entity":
                data["entity_id"] = entity_id_by_title.get(title, title_hash(title, "ENT"))
                data["entity_type"] = "institution" if any(word in title for word in ("위원회", "부", "원", "법원", "재판소")) else "organization"

        refs = data.get("source_refs") if isinstance(data.get("source_refs"), list) else []
        if page_type in {"concept", "analysis", "entity"} and data.get("confidence") == "high":
            if not refs or any(source_by_id.get(ref, {}).get("source_type", "").startswith("official_") is False for ref in refs if isinstance(ref, str)):
                data["confidence"] = "medium"
        if page_type in {"concept", "analysis", "entity"}:
            body = append_citation(body, refs[0] if refs and isinstance(refs[0], str) else None)

        if page_type == "case":
            data.setdefault("source_refs", [])
            data["status"] = "active"

        # Remove accidental v1 event fields from all source pages.  The event
        # lifecycle is now represented only by case pages.
        if page_type == "source":
            data.pop("next_review_date", None)

        pages[rel] = (path, data, body)

    # Stable five-case pilot.  Source IDs remain on source pages; cases are a
    # separate event layer so later official decisions can be attached without
    # rewriting the source record.
    pilot = [
        {
            "case_id": "CASE-JDC-2026-04-09",
            "title": "JDC 면세점 판매사원 원청교섭 사건",
            "aliases": ["JDC 원청교섭 사건", "JDC 면세점 사건"],
            "case_numbers": ["미공개"], "adjudicating_body": "제주지방노동위원회",
            "parties": ["제주국제자유도시개발센터", "백화점면세점판매서비스노동조합"],
            "party_entity_refs": [entity_id_by_title.get("제주국제자유도시개발센터", title_hash("제주국제자유도시개발센터", "ENT"))],
            "issue_refs": ["사용자성", "교섭단위 분리", "원하청 교섭"],
            "source_refs": ["SRC-79610D6485", "SRC-AD9485117E"], "event_status": "pending",
            "verification_status": "partial", "last_checked": "2026-07-26", "next_review_date": "2026-08-15",
            "summary": "제주지방노동위원회의 JDC 면세점 판매사원 사용자성·교섭단위 판단과 후속 원청교섭 절차를 추적하는 사건 기록입니다.",
        },
        {
            "case_id": "CASE-HYUNDAI-2026-06-15",
            "title": "현대자동차 하청노조 교섭요구 공고 사건",
            "aliases": ["현대차 원청 사용자성 사건", "울산지노위 현대차 사건"],
            "case_numbers": ["미공개"], "adjudicating_body": "울산지방노동위원회",
            "parties": ["현대자동차", "전국금속노동조합 소속 하청노동조합"],
            "party_entity_refs": [entity_id_by_title.get("현대자동차", title_hash("현대자동차", "ENT"))],
            "issue_refs": ["사용자성", "실질적 지배력", "원하청 교섭"],
            "source_refs": ["SRC-5636D70E3A", "SRC-E922DA7580"], "event_status": "decided",
            "verification_status": "partial", "last_checked": "2026-07-26",
            "summary": "울산지방노동위원회가 현대자동차 하청노조의 교섭요구 사실공고 시정신청을 판단한 다층적 사용자성 사건입니다.",
        },
        {
            "case_id": "CASE-POSCO-2026-04-08",
            "title": "포스코 하청노조 교섭단위 분리 사건",
            "aliases": ["포스코 원청교섭 사건", "포스코 교섭단위 분리"],
            "case_numbers": ["미공개"], "adjudicating_body": "경북지방노동위원회·중앙노동위원회",
            "parties": ["포스코", "포스코 하청노동조합들"],
            "party_entity_refs": [entity_id_by_title.get("포스코", title_hash("포스코", "ENT"))],
            "issue_refs": ["교섭단위 분리", "사용자성", "원하청 교섭"],
            "source_refs": ["SRC-87D47C0A1A", "SRC-E4571543DE"], "event_status": "decided",
            "verification_status": "partial", "last_checked": "2026-07-26",
            "summary": "포스코 하청노조 사이의 교섭단위 분리 신청과 중앙노동위원회 재심 결과를 단계별로 기록한 사건입니다.",
        },
        {
            "case_id": "CASE-COUPANGCLS-2026-04-09",
            "title": "쿠팡CLS 하청노조 교섭단위 분리 사건",
            "aliases": ["쿠팡CLS 교섭 분리 기각 사건", "CLS 교섭단위 사건"],
            "case_numbers": ["미공개"], "adjudicating_body": "서울지방노동위원회·중앙노동위원회",
            "parties": ["쿠팡로지스틱스서비스", "하청 택배기사 노동조합들"],
            "party_entity_refs": [entity_id_by_title.get("쿠팡로지스틱스서비스", title_hash("쿠팡로지스틱스서비스", "ENT"))],
            "issue_refs": ["교섭단위 분리", "사용자성", "교섭창구 단일화"],
            "source_refs": ["SRC-0AC5734CA9", "SRC-C943D804F0"], "event_status": "decided",
            "verification_status": "partial", "last_checked": "2026-07-26",
            "summary": "쿠팡CLS 원청 사용자성 인정과 상급단체 차이에 따른 교섭단위 분리 기각을 함께 추적하는 사건입니다.",
        },
        {
            "case_id": "CASE-JUNGHUNG-2026-06-04",
            "title": "중흥건설 타워크레인 노동자 원청교섭 사건",
            "aliases": ["중흥건설 사용자성 사건", "중흥건설 타워크레인 사건"],
            "case_numbers": ["미공개"], "adjudicating_body": "전남지방노동위원회·중앙노동위원회",
            "parties": ["중흥건설", "한국타워크레인조종사노동조합"],
            "party_entity_refs": [entity_id_by_title.get("중흥건설", title_hash("중흥건설", "ENT"))],
            "issue_refs": ["사용자성", "실질적 지배력", "원하청 교섭"],
            "source_refs": ["SRC-D9633BCE43"], "event_status": "decided",
            "verification_status": "partial", "last_checked": "2026-07-26",
            "summary": "중앙노동위원회가 중흥건설의 타워크레인 노동자 관련 의제별 사용자성을 인정한 재심 사건입니다.",
        },
    ]
    cases_dir = WIKI / "cases"
    cases_dir.mkdir(exist_ok=True)
    for case in pilot:
        case_body = f"# {case['title']}\n\n## 사건 개요\n\n{case['summary']} [@{case['source_refs'][0]}]\n\n## 확인 범위\n\n공식 결정서와 사건번호가 공개되지 않은 부분은 보도·공개자료의 범위에서만 기록하며, 새로운 결정 원문이 확인되면 `decision_source_refs`에 공식 출처를 추가합니다.\n\n## 관련 항목\n\n" + "\n".join(f"- [[{ref}]]" for ref in case["issue_refs"])
        data = {
            "title": case["title"], "aliases": case["aliases"],
            "tags": ["type/case", "domain/labor-law", "area/collective-labor", "status/active"],
            "created": "2026-07-26", "updated": "2026-07-26", "status": "active", "summary": case["summary"],
            **{key: value for key, value in case.items() if key not in {"title", "aliases", "summary"}},
            "decision_source_refs": [],
            "review_due": "2026-08-15", "review_reason": "사건번호·공식 결정서 공개 여부 재확인",
        }
        filename = re.sub(r"[\\/:*?\"<>|]", "-", case["title"]) + ".md"
        pages[f"cases/{filename}"] = (cases_dir / filename, data, case_body)

    case_by_source = {
        "SRC-79610D6485": "CASE-JDC-2026-04-09", "SRC-AD9485117E": "CASE-JDC-2026-04-09",
        "SRC-5636D70E3A": "CASE-HYUNDAI-2026-06-15", "SRC-E922DA7580": "CASE-HYUNDAI-2026-06-15",
        "SRC-87D47C0A1A": "CASE-POSCO-2026-04-08", "SRC-E4571543DE": "CASE-POSCO-2026-04-08",
        "SRC-0AC5734CA9": "CASE-COUPANGCLS-2026-04-09", "SRC-C943D804F0": "CASE-COUPANGCLS-2026-04-09",
        "SRC-D9633BCE43": "CASE-JUNGHUNG-2026-06-04",
    }
    for rel, (path, data, body) in list(pages.items()):
        if not rel.startswith("sources/") or data.get("source_id") not in case_by_source:
            continue
        data["case_refs"] = [case_by_source[str(data["source_id"])] ]
        pages[rel] = (path, data, body)

    for path, data, body in pages.values():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(dump_frontmatter(data, body), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    migrate()
    print("schema v2 migration completed")
