#!/usr/bin/env python3
"""Regenerate the committed wiki catalogue from page frontmatter.

Usage: ``python -I -B scripts/sync_wiki.py`` or ``--check`` in CI.  Only
``wiki/index.md`` is generated; no source or raw document is modified.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WIKI = ROOT / "wiki"
INDEX = WIKI / "index.md"
sys.path.insert(0, str(ROOT))

from scripts.frontmatter import parse_frontmatter_lines  # noqa: E402
from scripts.schema import INDEX_SECTION_BY_TYPE, TYPE_BY_DIRECTORY  # noqa: E402


def parse_page(path: Path, *, wiki_root: Path = WIKI) -> dict[str, object]:
    lines = path.read_text(encoding="utf-8").replace("\r\n", "\n").split("\n")
    if not lines or lines[0] != "---":
        raise ValueError(f"{path}: 첫 줄에 YAML 프론트매터 구분자 `---`가 필요합니다.")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError(f"{path}: 프론트매터 닫는 구분자 `---`가 없습니다.") from exc
    result, _, issues = parse_frontmatter_lines(lines[1:end], start_line=2)
    if issues:
        details = "; ".join(f"{issue.code}({issue.line}행): {issue.message}" for issue in issues)
        raise ValueError(f"{path}: 프론트매터를 해석할 수 없습니다: {details}")
    result["relative"] = path.relative_to(wiki_root).as_posix()
    return result


def type_for(relative: str) -> str:
    if "/" not in relative:
        return "meta"
    return TYPE_BY_DIRECTORY.get(relative.split("/", 1)[0], "meta")


def title_of(data: dict[str, object]) -> str:
    return str(data.get("title") or Path(str(data["relative"])).stem)


def summary_of(data: dict[str, object]) -> str:
    summary = str(data.get("summary") or "").replace("\n", " ").strip()
    return summary if summary else f"{title_of(data)}에 관한 노동법 위키 문서입니다."


def source_count(data: dict[str, object], page_type: str) -> int:
    if page_type == "source":
        return len(data.get("raw_sources") or []) + len(data.get("source_urls") or [])
    return len(data.get("source_refs") or [])


def source_label(data: dict[str, object], page_type: str) -> str:
    count = source_count(data, page_type)
    if page_type == "source":
        raw_count = len(data.get("raw_sources") or [])
        url_count = len(data.get("source_urls") or [])
        return f"소스 {count}개 · 원문 {raw_count} · URL {url_count}"
    return f"근거 {count}개"


def section_name(page_type: str) -> str:
    return INDEX_SECTION_BY_TYPE.get(page_type, "메타")


def route_target(data: dict[str, object]) -> str:
    return title_of(data)


def generate() -> str:
    pages = [parse_page(path) for path in sorted(WIKI.rglob("*.md"), key=lambda p: p.as_posix().casefold()) if path != INDEX]
    grouped: dict[str, list[dict[str, object]]] = {name: [] for name in ["홈", "메타", "소스", "개념", "개체", "분석", "사건"]}
    for data in pages:
        rel = str(data["relative"])
        if rel == "overview.md":
            grouped["홈"].append(data)
            continue
        grouped[section_name(type_for(rel))].append(data)
    for values in grouped.values():
        values.sort(key=lambda item: title_of(item).casefold())

    lines = [
        "---", "title: 노동법 위키 색인", "aliases: [\"색인\", \"인덱스\", \"전체 카탈로그\"]",
        "tags: [\"type/meta\", \"domain/labor-law\", \"status/active\"]", "created: 2026-06-01",
        "updated: 2026-07-26", "status: active", "summary: \"전체 위키 페이지 카탈로그와 출처·사건·근거 수를 자동 집계한 색인입니다.\"",
        "source_refs: []", "---", "", "# 노동법 위키 색인", "",
        "<!-- BEGIN GENERATED CATALOG -->",
    ]
    for section, values in grouped.items():
        lines.extend([f"## {section}", ""])
        for data in values:
            lines.append(f"- [[{route_target(data)}]] — {summary_of(data)} ({source_label(data, type_for(str(data['relative'])))})")
        lines.append("")
    lines.extend([
        "<!-- END GENERATED CATALOG -->", "", "## 관련 항목", "", "- [[overview]]", "- [[log]]", "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="현재 index.md가 생성 결과와 같은지만 확인")
    args = parser.parse_args()
    generated = generate()
    current = INDEX.read_text(encoding="utf-8") if INDEX.is_file() else ""
    if args.check:
        if current != generated:
            print("wiki/index.md가 최신 생성 결과와 다릅니다.")
            return 1
        print("wiki/index.md 생성 상태가 최신입니다.")
        return 0
    INDEX.write_text(generated, encoding="utf-8", newline="\n")
    print("wiki/index.md를 동기화했습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
