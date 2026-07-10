#!/usr/bin/env python3
"""Validate the LaborLaw Wiki without third-party dependencies.

The current-tree checks cover Markdown structure, lightweight YAML frontmatter,
Obsidian links, the catalogue, and source provenance.  With ``--base`` the
script also enforces repository history rules that require Git context.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import unicodedata
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
WIKI = ROOT / "wiki"
RAW = ROOT / "raw"

COMMON_REQUIRED = ("title", "aliases", "tags", "created", "updated", "status")
STATUS_VALUES = {"draft", "active", "review", "archived"}
LEGAL_AREAS = {"근로기준", "집단노동", "산재", "고용평등", "비정규직", "퇴직급여", "중대재해", "입법사"}
AUTHORITIES = {"법령", "대법원", "헌법재판소", "고용노동부", "중앙노동위원회", "국회", "학설", "기타"}
LEGAL_STATUSES = {"current", "amended", "repealed", "overruled", "superseded", "uncertain"}
CONFIDENCE_VALUES = {"high", "medium", "low"}
EVENT_STATUSES = {"scheduled", "pending", "decided", "appealed", "final", "superseded", "closed", "uncertain"}
OPEN_EVENT_STATUSES = {"scheduled", "pending", "appealed", "uncertain"}
LOG_TYPES = {"ingest", "analysis", "update", "lint", "maintenance", "refactor", "remove", "chore"}
DATE_FIELDS = {
    "created",
    "updated",
    "effective_date",
    "decision_date",
    "promulgation_date",
    "publication_date",
    "retrieved",
    "as_of_date",
    "next_review_date",
}
SOURCE_FIELDS = {
    "source_id",
    "source_type",
    "publisher",
    "raw_sources",
    "raw_sha256",
    "attachments",
    "source_urls",
    "retrieved",
    "related_source_refs",
    "superseded_by",
    "reported_decision_dates",
    "case_decisions",
    "reported_authority",
    "publication_period",
}
TYPE_BY_DIRECTORY = {
    "sources": "source",
    "concepts": "concept",
    "entities": "entity",
    "analyses": "analysis",
    "meta": "meta",
}
INDEX_SECTION_BY_TYPE = {
    "source": "소스",
    "concept": "개념",
    "entity": "개체",
    "analysis": "분석",
    "meta": "메타",
}
CATALOGUE_SECTIONS = {"홈", "메타", "소스", "개념", "개체", "분석"}

KEY_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_]*):(?:[ \t]*(.*))?$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TAG_RE = re.compile(r"^(type|domain|area|status)/[a-z0-9][a-z0-9-]*$")
SOURCE_ID_RE = re.compile(r"^SRC-[A-Z0-9][A-Z0-9._-]{2,}$")
SOURCE_TYPE_RE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
WARNING_RE = re.compile(r"^>\s*\[!WARNING\]", re.MULTILINE)
WIKILINK_RE = re.compile(r"(?<!!)\[\[([^\]\n]+)\]\]|!\[\[([^\]\n]+)\]\]")
LOG_HEADER_RE = re.compile(r"^## \[(\d{4}-\d{2}-\d{2})\] ([a-z]+) \| (.+?)\s*$", re.MULTILINE)
ANY_LOG_HEADER_RE = re.compile(r"^## \[([^\]]+)\] ([^|]+) \| (.+?)\s*$", re.MULTILINE)


@dataclass
class Diagnostic:
    severity: str
    code: str
    path: str
    line: int
    message: str


@dataclass
class Page:
    path: Path
    rel: str
    text: str
    frontmatter: dict[str, object]
    key_lines: dict[str, int]
    body: str
    body_start_line: int
    expected_type: str
    headings: list[tuple[int, str, int]] = field(default_factory=list)

    def line_for(self, key: str) -> int:
        return self.key_lines.get(key, 1)


class Linter:
    def __init__(self, *, base: str | None, strict_warnings: bool) -> None:
        self.base = base
        self.strict_warnings = strict_warnings
        self.diagnostics: list[Diagnostic] = []
        self.pages: list[Page] = []
        self.page_by_rel: dict[str, Page] = {}
        self.identities: dict[str, list[Page]] = {}
        self.source_by_id: dict[str, Page] = {}
        self.raw_references: dict[str, list[tuple[Page, str]]] = {}

    def add(
        self,
        severity: str,
        code: str,
        path: Path | str,
        message: str,
        line: int = 1,
    ) -> None:
        if isinstance(path, Path):
            try:
                display = path.relative_to(ROOT).as_posix()
            except ValueError:
                display = path.as_posix()
        else:
            display = path.replace("\\", "/")
        self.diagnostics.append(Diagnostic(severity, code, display, max(line, 1), message))

    def error(self, code: str, path: Path | str, message: str, line: int = 1) -> None:
        self.add("error", code, path, message, line)

    def warning(self, code: str, path: Path | str, message: str, line: int = 1) -> None:
        self.add("warning", code, path, message, line)

    def run(self) -> int:
        if not WIKI.is_dir():
            self.error("REPO_WIKI_MISSING", "wiki", "wiki 디렉토리를 찾을 수 없습니다.")
            return self.report()

        self.load_pages()
        self.build_identity_index()
        self.validate_pages()
        self.build_source_index()
        self.validate_source_lineage()
        self.validate_links()
        self.validate_index()
        self.validate_log()
        if self.base:
            self.validate_against_base(self.base)
        return self.report()

    def report(self) -> int:
        order = {"error": 0, "warning": 1}
        self.diagnostics.sort(key=lambda d: (order.get(d.severity, 9), d.path.casefold(), d.line, d.code))
        github = os.environ.get("GITHUB_ACTIONS") == "true"
        for item in self.diagnostics:
            label = item.severity.upper()
            print(f"{label} [{item.code}] {item.path}:{item.line} {item.message}")
            if github:
                escaped = item.message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
                print(f"::{item.severity} file={item.path},line={item.line},title={item.code}::{escaped}")
        errors = sum(d.severity == "error" for d in self.diagnostics)
        warnings = sum(d.severity == "warning" for d in self.diagnostics)
        print(f"\n검사 완료: 위키 {len(self.pages)}개, 오류 {errors}개, 경고 {warnings}개")
        return 1 if errors or (self.strict_warnings and warnings) else 0

    def load_pages(self) -> None:
        for path in sorted(WIKI.rglob("*.md"), key=lambda p: p.as_posix().casefold()):
            rel = path.relative_to(WIKI).as_posix()
            if rel != unicodedata.normalize("NFC", rel):
                self.error("ENCODING_FILENAME_NFC", path, "위키 파일명이 NFC 정규형이 아닙니다.")
            try:
                data = path.read_bytes()
            except OSError as exc:
                self.error("FILE_READ", path, f"파일을 읽을 수 없습니다: {exc}")
                continue
            if data.startswith(b"\xef\xbb\xbf"):
                self.error("ENCODING_BOM", path, "UTF-8 BOM을 제거하세요.")
            try:
                text = data.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                self.error("ENCODING_UTF8", path, f"UTF-8로 해석할 수 없습니다: byte {exc.start}")
                continue
            if text != unicodedata.normalize("NFC", text):
                line = first_normalization_difference_line(text)
                self.error("ENCODING_NFC", path, "문서 텍스트가 NFC 정규형이 아닙니다.", line)

            expected_type = expected_page_type(rel)
            if expected_type is None:
                self.error("PAGE_LOCATION", path, "위키 페이지는 index.md·log.md·overview.md 또는 sources/·concepts/·entities/·analyses/·meta/ 아래에 있어야 합니다.")
                expected_type = "meta"
            parsed = self.parse_page(path, rel, text, expected_type)
            if parsed is not None:
                self.pages.append(parsed)
                self.page_by_rel[rel] = parsed

    def parse_page(self, path: Path, rel: str, text: str, expected_type: str) -> Page | None:
        lines = text.splitlines()
        if not lines or lines[0] != "---":
            self.error("FM_DELIMITER", path, "첫 줄에 YAML 프론트매터 구분자 `---`가 필요합니다.")
            return None
        try:
            end = lines.index("---", 1)
        except ValueError:
            self.error("FM_DELIMITER", path, "프론트매터 닫는 구분자 `---`가 없습니다.")
            return None
        frontmatter, key_lines = self.parse_frontmatter(path, lines[1:end], start_line=2)
        body_lines = lines[end + 1 :]
        body = "\n".join(body_lines)
        headings = extract_headings(body_lines, end + 2)
        return Page(path, rel, text, frontmatter, key_lines, body, end + 2, expected_type, headings)

    def parse_frontmatter(
        self, path: Path, lines: list[str], *, start_line: int
    ) -> tuple[dict[str, object], dict[str, int]]:
        result: dict[str, object] = {}
        key_lines: dict[str, int] = {}
        index = 0
        while index < len(lines):
            raw_line = lines[index]
            line_no = start_line + index
            if not raw_line.strip() or raw_line.lstrip().startswith("#"):
                index += 1
                continue
            leading = raw_line[: len(raw_line) - len(raw_line.lstrip(" \t"))]
            if "\t" in leading:
                self.error("FM_TAB_INDENT", path, "YAML 들여쓰기에 탭을 사용할 수 없습니다.", line_no)
                index += 1
                continue
            if raw_line.startswith((" ", "\t")):
                self.error("FM_INDENT", path, "최상위 프론트매터 키에 들여쓰기를 사용할 수 없습니다.", line_no)
                index += 1
                continue
            match = KEY_RE.match(raw_line)
            if not match:
                self.error("FM_SYNTAX", path, "지원하지 않는 프론트매터 문법입니다.", line_no)
                index += 1
                continue
            key, raw_value = match.group(1), match.group(2) or ""
            if key in result:
                self.error("FM_DUPLICATE_KEY", path, f"중복 키 `{key}`가 있습니다.", line_no)
            key_lines[key] = line_no
            if raw_value.strip():
                try:
                    value = parse_yaml_value(raw_value.strip())
                except ValueError as exc:
                    self.error("FM_VALUE", path, f"`{key}` 값을 해석할 수 없습니다: {exc}", line_no)
                    value = raw_value.strip()
                if key != "case_decisions" and contains_structured_value(value):
                    self.error("FM_MAPPING_SCOPE", path, "JSON 스타일 인라인 매핑은 case_decisions에서만 사용할 수 있습니다.", line_no)
                result[key] = value
                index += 1
                continue

            values: list[object] = []
            cursor = index + 1
            saw_item = False
            while cursor < len(lines):
                child = lines[cursor]
                child_no = start_line + cursor
                if not child.strip() or child.lstrip().startswith("#"):
                    cursor += 1
                    continue
                if not child.startswith((" ", "\t")):
                    break
                child_leading = child[: len(child) - len(child.lstrip(" \t"))]
                if "\t" in child_leading:
                    self.error("FM_TAB_INDENT", path, "YAML 목록 들여쓰기에 탭을 사용할 수 없습니다.", child_no)
                    cursor += 1
                    continue
                item_match = re.match(r"^[ \t]+-[ \t]*(.*)$", child)
                if not item_match:
                    self.error("FM_NESTING", path, f"`{key}`에는 단순 목록만 사용할 수 있습니다.", child_no)
                    cursor += 1
                    continue
                try:
                    values.append(parse_yaml_value(item_match.group(1).strip()))
                    saw_item = True
                except ValueError as exc:
                    self.error("FM_VALUE", path, f"`{key}` 목록 값을 해석할 수 없습니다: {exc}", child_no)
                cursor += 1
            value = values if saw_item else None
            if key != "case_decisions" and contains_structured_value(value):
                self.error("FM_MAPPING_SCOPE", path, "JSON 스타일 인라인 매핑은 case_decisions에서만 사용할 수 있습니다.", line_no)
            result[key] = value
            index = cursor
        return result, key_lines

    def build_identity_index(self) -> None:
        for page in self.pages:
            identities = {
                page.rel.removesuffix(".md"),
                f"wiki/{page.rel.removesuffix('.md')}",
                page.path.stem,
            }
            title = page.frontmatter.get("title")
            if isinstance(title, str) and title.strip():
                identities.add(title.strip())
            aliases = page.frontmatter.get("aliases")
            if isinstance(aliases, list):
                identities.update(str(alias).strip() for alias in aliases if isinstance(alias, str) and alias.strip())
            for identity in identities:
                key = normalize_identity(identity)
                bucket = self.identities.setdefault(key, [])
                if page not in bucket:
                    bucket.append(page)
        for identity, pages in self.identities.items():
            unique = list(dict.fromkeys(page.rel for page in pages))
            if len(unique) > 1:
                self.error("IDENTITY_AMBIGUOUS", pages[0].path, f"제목·별칭·파일명 식별자 `{identity}`가 여러 페이지에 중복됩니다: {', '.join(unique)}")

    def validate_pages(self) -> None:
        for page in self.pages:
            fm = page.frontmatter
            for key in COMMON_REQUIRED:
                if key not in fm:
                    self.error("FM_REQUIRED", page.path, f"필수 키 `{key}`가 없습니다.")
            if "sources" in fm:
                self.error("FM_LEGACY_SOURCES", page.path, "폐기된 `sources` 대신 `source_refs` 또는 출처 계보 필드를 사용하세요.", page.line_for("sources"))

            title = require_nonempty_string(self, page, "title")
            aliases = require_string_list(self, page, "aliases")
            tags = require_string_list(self, page, "tags")
            status = require_nonempty_string(self, page, "status")

            if status and status not in STATUS_VALUES:
                self.error("FM_ENUM_STATUS", page.path, f"status는 {sorted(STATUS_VALUES)} 중 하나여야 합니다.", page.line_for("status"))
            if len(tags) != len(set(tags)):
                self.error("TAG_DUPLICATE", page.path, "tags에 중복 값이 있습니다.", page.line_for("tags"))
            for tag in tags:
                if not TAG_RE.fullmatch(tag):
                    self.error("TAG_FORMAT", page.path, f"허용되지 않는 태그 형식입니다: `{tag}`", page.line_for("tags"))
            type_tags = [tag for tag in tags if tag.startswith("type/")]
            expected_tag = f"type/{page.expected_type}"
            if type_tags != [expected_tag]:
                self.error("TAG_TYPE", page.path, f"페이지 위치에 맞는 `{expected_tag}` 태그를 정확히 하나 사용하세요.", page.line_for("tags"))
            status_tags = [tag for tag in tags if tag.startswith("status/")]
            expected_status_tag = f"status/{status}" if status else None
            if expected_status_tag and status_tags != [expected_status_tag]:
                self.error("TAG_STATUS", page.path, f"`{expected_status_tag}` 태그를 정확히 하나 사용하세요.", page.line_for("tags"))
            if "domain/labor-law" not in tags:
                self.error("TAG_DOMAIN", page.path, "모든 위키 페이지에 `domain/labor-law` 태그가 필요합니다.", page.line_for("tags"))

            parsed_dates: dict[str, date] = {}
            for key in DATE_FIELDS & fm.keys():
                value = fm[key]
                if not isinstance(value, str) or not DATE_RE.fullmatch(value):
                    self.error("FM_DATE_FORMAT", page.path, f"`{key}`는 YYYY-MM-DD 형식이어야 합니다.", page.line_for(key))
                    continue
                try:
                    parsed_dates[key] = datetime.strptime(value, "%Y-%m-%d").date()
                except ValueError:
                    self.error("FM_DATE_VALUE", page.path, f"`{key}`가 실제 달력 날짜가 아닙니다: {value}", page.line_for(key))
            if "created" in fm and "created" not in parsed_dates:
                self.error("FM_DATE_REQUIRED", page.path, "`created`에 유효한 날짜가 필요합니다.", page.line_for("created"))
            if "updated" in fm and "updated" not in parsed_dates:
                self.error("FM_DATE_REQUIRED", page.path, "`updated`에 유효한 날짜가 필요합니다.", page.line_for("updated"))
            if parsed_dates.get("created") and parsed_dates.get("updated") and parsed_dates["updated"] < parsed_dates["created"]:
                self.error("FM_DATE_ORDER", page.path, "updated는 created보다 이를 수 없습니다.", page.line_for("updated"))

            validate_optional_enum(self, page, "legal_area", LEGAL_AREAS)
            validate_optional_enum(self, page, "authority", AUTHORITIES)
            if "reported_authority" in fm:
                require_nonempty_string(self, page, "reported_authority")
            validate_optional_enum(self, page, "legal_status", LEGAL_STATUSES)
            validate_optional_enum(self, page, "confidence", CONFIDENCE_VALUES)
            event_status = validate_optional_enum(self, page, "event_status", EVENT_STATUSES)
            if event_status in OPEN_EVENT_STATUSES and "next_review_date" not in parsed_dates:
                self.error("EVENT_REVIEW_REQUIRED", page.path, f"event_status `{event_status}`에는 next_review_date가 필요합니다.", page.line_for("event_status"))
            next_review = parsed_dates.get("next_review_date")
            if next_review and next_review < date.today():
                self.warning("EVENT_REVIEW_DUE", page.path, f"next_review_date {next_review.isoformat()}가 지났습니다. 후속 상태를 확인하세요.", page.line_for("next_review_date"))

            h1s = [(text, line) for level, text, line in page.headings if level == 1]
            if len(h1s) != 1:
                self.error("MD_H1_COUNT", page.path, f"H1 제목은 정확히 하나여야 합니다(현재 {len(h1s)}개).")
            elif title and normalize_heading(h1s[0][0]) != normalize_heading(title):
                self.error("MD_H1_TITLE", page.path, "H1 제목이 frontmatter title과 일치하지 않습니다.", h1s[0][1])
            related = [(idx, heading) for idx, heading in enumerate(page.headings) if heading[0] == 2 and normalize_heading(heading[1]) == "관련 항목"]
            if len(related) != 1:
                self.error("MD_RELATED_COUNT", page.path, "`## 관련 항목` 섹션은 정확히 하나여야 합니다.")
            else:
                h2s = [heading for heading in page.headings if heading[0] == 2]
                if not h2s or normalize_heading(h2s[-1][1]) != "관련 항목":
                    self.error("MD_RELATED_LAST", page.path, "`## 관련 항목`은 마지막 H2 섹션이어야 합니다.", related[0][1][2])

            if WARNING_RE.search(remove_fenced_code(page.body)):
                if status != "review":
                    self.error("WARNING_STATUS", page.path, "WARNING이 있는 페이지는 `status: review`여야 합니다.", page.line_for("status"))

            if aliases and title and title in aliases:
                self.error("FM_ALIAS_TITLE", page.path, "aliases에 title과 같은 값을 반복하지 마세요.", page.line_for("aliases"))

    def build_source_index(self) -> None:
        for page in self.pages:
            if page.expected_type != "source":
                continue
            source_id = page.frontmatter.get("source_id")
            if not isinstance(source_id, str) or not source_id.strip():
                continue
            if source_id in self.source_by_id:
                other = self.source_by_id[source_id]
                self.error("SOURCE_ID_DUPLICATE", page.path, f"source_id `{source_id}`가 {other.rel}과 중복됩니다.", page.line_for("source_id"))
            else:
                self.source_by_id[source_id] = page

    def validate_source_lineage(self) -> None:
        for page in self.pages:
            if page.expected_type == "source":
                self.validate_source_page(page)
            else:
                self.validate_source_refs(page)
        self.validate_raw_coverage()

    def validate_source_page(self, page: Page) -> None:
        fm = page.frontmatter
        for key in ("source_id", "source_type", "publisher", "raw_sources", "raw_sha256", "source_urls"):
            if key not in fm:
                self.error("SOURCE_REQUIRED", page.path, f"출처 페이지 필수 키 `{key}`가 없습니다.")
        if "source_refs" in fm:
            self.error("SOURCE_REFS_ON_SOURCE", page.path, "출처 페이지는 source_refs를 사용하지 않습니다.", page.line_for("source_refs"))

        source_id = require_nonempty_string(self, page, "source_id")
        if source_id and not SOURCE_ID_RE.fullmatch(source_id):
            self.error("SOURCE_ID_FORMAT", page.path, "source_id는 `SRC-`로 시작하는 영문 대문자·숫자·점·밑줄·하이픈 식별자여야 합니다.", page.line_for("source_id"))
        source_type = require_nonempty_string(self, page, "source_type")
        if source_type and not SOURCE_TYPE_RE.fullmatch(source_type):
            self.error("SOURCE_TYPE_FORMAT", page.path, "source_type은 lower_snake_case여야 합니다.", page.line_for("source_type"))
        require_nonempty_string(self, page, "publisher")
        raw_sources = require_string_list(self, page, "raw_sources")
        raw_hashes = require_string_list(self, page, "raw_sha256")
        source_urls = require_string_list(self, page, "source_urls")
        attachments = optional_string_list(self, page, "attachments")
        related_refs = optional_string_list(self, page, "related_source_refs")

        if len(raw_sources) != len(raw_hashes):
            self.error("SOURCE_HASH_COUNT", page.path, "raw_sources와 raw_sha256의 항목 수가 같아야 합니다.", page.line_for("raw_sha256"))
        if len(raw_sources) != len(set(raw_sources)):
            self.error("SOURCE_RAW_DUPLICATE", page.path, "raw_sources에 중복 경로가 있습니다.", page.line_for("raw_sources"))
        if len(source_urls) != len(set(source_urls)):
            self.error("SOURCE_URL_DUPLICATE", page.path, "source_urls에 중복 URL이 있습니다.", page.line_for("source_urls"))
        if len(attachments) != len(set(attachments)):
            self.error("SOURCE_ATTACHMENT_DUPLICATE", page.path, "attachments에 중복 경로가 있습니다.", page.line_for("attachments"))
        if len(related_refs) != len(set(related_refs)):
            self.error("SOURCE_RELATED_DUPLICATE", page.path, "related_source_refs에 중복 ID가 있습니다.", page.line_for("related_source_refs"))
        if "raw_sources" in fm and "source_urls" in fm and not raw_sources and not source_urls:
            self.error("SOURCE_PROVENANCE_EMPTY", page.path, "raw_sources 또는 source_urls 중 하나 이상이 필요합니다.", page.line_for("raw_sources"))
        if source_urls and "retrieved" not in fm:
            self.error("SOURCE_RETRIEVED", page.path, "URL 출처에는 retrieved 날짜가 필요합니다.", page.line_for("source_urls"))
        if not raw_sources and raw_hashes:
            self.error("SOURCE_URL_ONLY_HASH", page.path, "URL 전용 출처의 raw_sha256은 빈 배열이어야 합니다.", page.line_for("raw_sha256"))

        for index, raw_ref in enumerate(raw_sources):
            target = self.validate_raw_path(page, raw_ref, "raw_sources")
            if target is None:
                continue
            self.raw_references.setdefault(raw_ref, []).append((page, "raw_sources"))
            if index >= len(raw_hashes):
                continue
            expected_hash = raw_hashes[index]
            if not SHA256_RE.fullmatch(expected_hash):
                self.error("SOURCE_HASH_FORMAT", page.path, f"`{raw_ref}`의 SHA-256은 64자리 16진수여야 합니다.", page.line_for("raw_sha256"))
                continue
            if target.is_file():
                actual_hash = sha256_file(target)
                if actual_hash.lower() != expected_hash.lower():
                    self.error("SOURCE_HASH_MISMATCH", page.path, f"`{raw_ref}`의 기록 해시가 실제 파일과 다릅니다(실제 {actual_hash}).", page.line_for("raw_sha256"))

        for attachment in attachments:
            if attachment in raw_sources:
                self.error("SOURCE_ATTACHMENT_OVERLAP", page.path, f"`{attachment}`가 raw_sources와 attachments에 중복됩니다.", page.line_for("attachments"))
            target = self.validate_raw_path(page, attachment, "attachments")
            if target is not None:
                self.raw_references.setdefault(attachment, []).append((page, "attachments"))

        for url in source_urls:
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc or any(char.isspace() for char in url):
                self.error("SOURCE_URL_FORMAT", page.path, f"유효한 HTTP(S) URL이 아닙니다: `{url}`", page.line_for("source_urls"))

        if "decision_dates" in fm:
            self.error("SOURCE_DECISION_DATES_LEGACY", page.path, "모호한 decision_dates 대신 reported_decision_dates를 사용하세요.", page.line_for("decision_dates"))
        if "reported_decision_dates" in fm:
            reported_dates = optional_string_list(self, page, "reported_decision_dates")
            if len(reported_dates) != len(set(reported_dates)):
                self.error("SOURCE_REPORTED_DATE_DUPLICATE", page.path, "reported_decision_dates에 중복 날짜가 있습니다.", page.line_for("reported_decision_dates"))
            for value in reported_dates:
                if not is_valid_date(value):
                    self.error("SOURCE_REPORTED_DATE", page.path, f"reported_decision_dates의 값이 유효한 YYYY-MM-DD 날짜가 아닙니다: `{value}`", page.line_for("reported_decision_dates"))
        if "case_decisions" in fm:
            case_decisions = fm["case_decisions"]
            if not isinstance(case_decisions, list) or not case_decisions:
                self.error("SOURCE_CASE_DECISIONS", page.path, "case_decisions는 하나 이상의 구조화 판정 기록 목록이어야 합니다.", page.line_for("case_decisions"))
            else:
                allowed_keys = {"case_number", "decision_date", "court", "event_status"}
                seen_cases: set[tuple[str, str]] = set()
                for position, item in enumerate(case_decisions, start=1):
                    if not isinstance(item, dict):
                        self.error("SOURCE_CASE_DECISION_TYPE", page.path, f"case_decisions {position}번째 항목은 JSON 스타일 매핑이어야 합니다.", page.line_for("case_decisions"))
                        continue
                    unknown = set(item) - allowed_keys
                    if unknown:
                        self.error("SOURCE_CASE_DECISION_KEY", page.path, f"case_decisions {position}번째 항목에 지원하지 않는 키가 있습니다: {', '.join(sorted(str(key) for key in unknown))}", page.line_for("case_decisions"))
                    case_number = item.get("case_number")
                    decision_date = item.get("decision_date")
                    if not isinstance(case_number, str) or not case_number.strip():
                        self.error("SOURCE_CASE_NUMBER", page.path, f"case_decisions {position}번째 항목에 비어 있지 않은 case_number가 필요합니다.", page.line_for("case_decisions"))
                    if not isinstance(decision_date, str) or not is_valid_date(decision_date):
                        self.error("SOURCE_CASE_DATE", page.path, f"case_decisions {position}번째 항목의 decision_date는 유효한 YYYY-MM-DD 날짜여야 합니다.", page.line_for("case_decisions"))
                    for optional_key in ("court", "event_status"):
                        value = item.get(optional_key)
                        if value is not None and (not isinstance(value, str) or not value.strip()):
                            self.error("SOURCE_CASE_VALUE", page.path, f"case_decisions {position}번째 항목의 {optional_key}는 비어 있지 않은 문자열이어야 합니다.", page.line_for("case_decisions"))
                    event_status_value = item.get("event_status")
                    if isinstance(event_status_value, str) and event_status_value not in EVENT_STATUSES:
                        self.error("SOURCE_CASE_STATUS", page.path, f"case_decisions {position}번째 항목의 event_status는 {sorted(EVENT_STATUSES)} 중 하나여야 합니다.", page.line_for("case_decisions"))
                    if isinstance(case_number, str) and isinstance(decision_date, str):
                        identity = (case_number.strip(), decision_date)
                        if identity in seen_cases:
                            self.error("SOURCE_CASE_DUPLICATE", page.path, f"중복된 사건번호·판정일 조합입니다: {identity[0]} / {identity[1]}", page.line_for("case_decisions"))
                        seen_cases.add(identity)
        if source_type == "official_decision":
            if "decision_date" not in fm:
                self.error("SOURCE_DECISION_DATE_REQUIRED", page.path, "official_decision에는 decision_date가 필요합니다.")
        elif "decision_date" in fm:
            self.error("SOURCE_DECISION_DATE_ROLE", page.path, "비공식 판정·판결 자료는 decision_date 대신 publication_date와 reported_decision_dates를 사용하세요.", page.line_for("decision_date"))
        if source_type in {"news", "stakeholder_statement"} and "publication_date" not in fm:
            self.error("SOURCE_PUBLICATION_DATE_REQUIRED", page.path, f"{source_type} 출처에는 publication_date가 필요합니다.")
        publication_period = fm.get("publication_period")
        if publication_period is not None:
            period_text = str(publication_period) if isinstance(publication_period, (str, int)) and not isinstance(publication_period, bool) else ""
            if not re.fullmatch(r"\d{4}(?:-(?:0[1-9]|1[0-2]))?", period_text):
                self.error("SOURCE_PUBLICATION_PERIOD", page.path, "publication_period는 YYYY 또는 YYYY-MM 형식이어야 합니다.", page.line_for("publication_period"))
            elif isinstance(fm.get("publication_date"), str) and not fm["publication_date"].startswith(period_text):
                self.error("SOURCE_PUBLICATION_CONFLICT", page.path, "publication_date와 publication_period의 연도·월이 서로 다릅니다.", page.line_for("publication_period"))
        if source_type in {"practitioner_commentary", "academic_paper", "research_report", "llm_report"} and "publication_date" not in fm and publication_period is None:
            self.error("SOURCE_PUBLICATION_REQUIRED", page.path, f"{source_type} 출처에는 publication_date 또는 publication_period가 필요합니다.")

        for ref in related_refs:
            if ref == source_id:
                self.error("SOURCE_RELATED_SELF", page.path, "related_source_refs에서 자기 source_id를 참조할 수 없습니다.", page.line_for("related_source_refs"))
            elif ref not in self.source_by_id:
                self.error("SOURCE_RELATED_MISSING", page.path, f"존재하지 않는 관련 source_id입니다: `{ref}`", page.line_for("related_source_refs"))
        if "superseded_by" in fm:
            superseded_by = require_nonempty_string(self, page, "superseded_by")
            if superseded_by == source_id:
                self.error("SOURCE_SUPERSEDED_SELF", page.path, "superseded_by에서 자기 source_id를 참조할 수 없습니다.", page.line_for("superseded_by"))
            elif superseded_by and superseded_by not in self.source_by_id:
                self.error("SOURCE_SUPERSEDED_MISSING", page.path, f"존재하지 않는 후속 source_id입니다: `{superseded_by}`", page.line_for("superseded_by"))
            if superseded_by and fm.get("legal_status") != "superseded":
                self.error("SOURCE_SUPERSEDED_STATUS", page.path, "superseded_by가 있으면 legal_status도 `superseded`여야 합니다.", page.line_for("legal_status"))

        if source_type == "official_law":
            for key in ("as_of_date", "effective_date", "version"):
                if key not in fm:
                    self.error("LAW_VERSION_REQUIRED", page.path, f"official_law에는 `{key}`가 필요합니다.")
            version = fm.get("version")
            if not isinstance(version, str) or not version.strip():
                self.error("LAW_VERSION_VALUE", page.path, "version에 법률번호와 버전 식별자를 기록하세요.", page.line_for("version"))
            elif not re.search(r"제\s*\d+\s*호", version):
                self.error("LAW_VERSION_NUMBER", page.path, "version에 `법률 제00000호`와 같은 공포번호를 기록하세요.", page.line_for("version"))
            if fm.get("authority") != "법령":
                self.error("LAW_AUTHORITY", page.path, "official_law의 authority는 `법령`이어야 합니다.", page.line_for("authority"))
            if not any(is_version_pinned_law_url(url) for url in source_urls):
                self.error("LAW_URL_VERSION", page.path, "source_urls에 lsiSeq·공포번호·공포일 등 버전 식별자가 포함된 국가법령정보센터 URL이 필요합니다.", page.line_for("source_urls"))
            elif isinstance(version, str) and version.strip():
                url_identifiers: set[tuple[str, str]] = set()
                for url in source_urls:
                    url_identifiers.update(law_url_identifiers(url))
                version_identifiers = law_version_identifiers(version)
                if not url_identifiers.intersection(version_identifiers):
                    self.error("LAW_VERSION_MISMATCH", page.path, "version의 lsiSeq·공포번호 등 식별자가 source_urls의 식별자와 일치해야 합니다.", page.line_for("version"))
            if "staged_effective_dates" in fm:
                staged_dates = optional_string_list(self, page, "staged_effective_dates")
                for value in staged_dates:
                    if not is_valid_date(value):
                        self.error("LAW_STAGED_DATE", page.path, f"staged_effective_dates의 값이 유효한 YYYY-MM-DD 날짜가 아닙니다: `{value}`", page.line_for("staged_effective_dates"))

        authority = fm.get("authority")
        if source_type in {"news", "practitioner_commentary", "llm_report", "stakeholder_statement"} and authority not in {None, "기타", "학설"}:
            self.error("SOURCE_AUTHORITY_ROLE", page.path, f"{source_type} 자료의 보도·논의 대상 기관은 authority가 아니라 reported_authority에 기록하세요.", page.line_for("authority"))

    def validate_source_refs(self, page: Page) -> None:
        fm = page.frontmatter
        has_refs = "source_refs" in fm
        if not has_refs:
            self.error("SOURCE_REFS_REQUIRED", page.path, "비출처 페이지에는 source_refs가 필요합니다.")
            refs: list[str] = []
        else:
            refs = require_string_list(self, page, "source_refs")
        if len(refs) != len(set(refs)):
            self.error("SOURCE_REFS_DUPLICATE", page.path, "source_refs에 중복 ID가 있습니다.", page.line_for("source_refs"))
        if page.expected_type != "meta" and has_refs and not refs:
            self.error("SOURCE_REFS_EMPTY", page.path, "개념·개체·분석 페이지에는 하나 이상의 source_refs가 필요합니다.", page.line_for("source_refs"))
        for ref in refs:
            if ref not in self.source_by_id:
                self.error("SOURCE_REF_MISSING", page.path, f"존재하지 않는 source_id입니다: `{ref}`", page.line_for("source_refs"))
        forbidden = SOURCE_FIELDS & fm.keys()
        if forbidden:
            self.error("SOURCE_FIELDS_ON_PAGE", page.path, f"비출처 페이지에 출처 계보 필드가 있습니다: {', '.join(sorted(forbidden))}")

    def validate_raw_path(self, page: Page, raw_ref: str, key: str) -> Path | None:
        if "\\" in raw_ref:
            self.error("SOURCE_RAW_SEPARATOR", page.path, f"`{raw_ref}`는 `/` 경로 구분자를 사용하세요.", page.line_for(key))
            return None
        posix = PurePosixPath(raw_ref)
        if posix.is_absolute() or not posix.parts or posix.parts[0] != "raw" or ".." in posix.parts:
            self.error("SOURCE_RAW_PATH", page.path, f"저장소 기준 `raw/...` 경로가 아닙니다: `{raw_ref}`", page.line_for(key))
            return None
        normalized = posix.as_posix()
        if normalized != raw_ref:
            self.error("SOURCE_RAW_NORMALIZE", page.path, f"정규화된 경로를 사용하세요: `{normalized}`", page.line_for(key))
            return None
        target = ROOT.joinpath(*posix.parts)
        try:
            target.resolve().relative_to(RAW.resolve())
        except ValueError:
            self.error("SOURCE_RAW_ESCAPE", page.path, f"raw 디렉토리를 벗어난 경로입니다: `{raw_ref}`", page.line_for(key))
            return None
        if not target.is_file():
            self.error("SOURCE_RAW_MISSING", page.path, f"원본 파일이 없습니다: `{raw_ref}`", page.line_for(key))
            return None
        return target

    def validate_raw_coverage(self) -> None:
        if not RAW.is_dir():
            self.error("RAW_MISSING", "raw", "raw 디렉토리를 찾을 수 없습니다.")
            return
        ignored = {"raw/README.md"}
        portable_paths: dict[str, str] = {}
        for path in sorted(RAW.rglob("*"), key=lambda p: p.as_posix().casefold()):
            rel = path.relative_to(ROOT).as_posix()
            portable_key = portable_path_key(rel)
            previous = portable_paths.get(portable_key)
            if previous is not None and previous != rel:
                self.error("RAW_PATH_COLLISION", path, f"NFC·대소문자 무시 기준으로 `{previous}`와 충돌합니다. Windows와 macOS에서 안전한 고유 경로를 사용하세요.")
            else:
                portable_paths[portable_key] = rel
            if rel != unicodedata.normalize("NFC", rel):
                self.error("RAW_FILENAME_NFC", path, "raw 경로가 NFC 정규형이 아닙니다. 새 경로를 커밋하기 전에 정규화하세요.")
            if is_forbidden_raw_symlink(path):
                self.error("RAW_SYMLINK", path, "raw에는 정상·댕글링 여부와 관계없이 심볼릭 링크를 둘 수 없습니다.")
                continue
            if not path.is_file():
                continue
            if rel in ignored or path.name in {".gitkeep", ".DS_Store", "Thumbs.db"}:
                continue
            if rel not in self.raw_references:
                self.error("RAW_UNREFERENCED", path, "어떤 출처 페이지의 raw_sources 또는 attachments에도 등록되지 않았습니다.")

    def resolve_page(self, target: str) -> tuple[Page | None, str | None]:
        cleaned = target.strip().replace("\\", "/")
        if cleaned.endswith(".md"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.removeprefix("./").removeprefix("wiki/")
        matches = self.identities.get(normalize_identity(cleaned), [])
        if not matches:
            return None, "missing"
        unique = list(dict.fromkeys(page.rel for page in matches))
        if len(unique) > 1:
            return None, "ambiguous"
        return matches[0], None

    def validate_links(self) -> None:
        for page in self.pages:
            visible = remove_fenced_code(page.body)
            for match in WIKILINK_RE.finditer(visible):
                inner = match.group(1) or match.group(2) or ""
                line = page.body_start_line + visible.count("\n", 0, match.start())
                link_target = inner.split("|", 1)[0].strip()
                if not link_target:
                    self.error("LINK_EMPTY", page.path, "빈 위키링크입니다.", line)
                    continue
                if "#" in link_target:
                    target_text, section = link_target.split("#", 1)
                else:
                    target_text, section = link_target, None
                if not target_text.strip():
                    target_page, problem = page, None
                else:
                    target_page, problem = self.resolve_page(target_text)
                if problem == "missing":
                    self.error("LINK_MISSING", page.path, f"대상 페이지를 찾을 수 없습니다: `[[{link_target}]]`", line)
                    continue
                if problem == "ambiguous":
                    self.error("LINK_AMBIGUOUS", page.path, f"여러 페이지와 일치하는 링크입니다: `[[{link_target}]]`", line)
                    continue
                if target_page is None:
                    continue
                if target_page.rel == page.rel:
                    self.error("LINK_SELF", page.path, f"자기 페이지로 향하는 링크입니다: `[[{link_target}]]`", line)
                if page.expected_type in {"source", "concept", "entity", "analysis"} and target_page.expected_type == "source":
                    self.error("LINK_SOURCE_CITATION", page.path, "본문에서 출처 요약 페이지를 인용 링크로 연결하지 말고 source_refs를 사용하세요.", line)
                if section is not None and section.strip():
                    self.validate_section_link(page, target_page, section.strip(), link_target, line)

    def validate_section_link(self, origin: Page, target: Page, section: str, link_target: str, line: int) -> None:
        if section.startswith("^"):
            block_id = re.escape(section[1:])
            if not re.search(rf"(?:^|\s)\^{block_id}\s*$", target.body, re.MULTILINE):
                self.error("LINK_BLOCK_MISSING", origin.path, f"대상 블록이 없습니다: `[[{link_target}]]`", line)
            return
        wanted = normalize_heading(section)
        if not any(normalize_heading(text) == wanted for _, text, _ in target.headings):
            self.error("LINK_SECTION_MISSING", origin.path, f"대상 섹션이 없습니다: `[[{link_target}]]`", line)

    def validate_index(self) -> None:
        index = self.page_by_rel.get("index.md")
        if index is None:
            self.error("INDEX_MISSING", "wiki/index.md", "색인 파일이 없습니다.")
            return
        current_section: str | None = None
        listed: dict[str, int] = {}
        body_lines = remove_fenced_code(index.body, strip_inline_code=False).splitlines()
        entry_re = re.compile(r"^\s*-\s+\[\[([^\]]+)\]\]\s+—\s+.+\s+\(소스\s+(\d+)개\)\s*$")
        for offset, raw_line in enumerate(body_lines):
            line_no = index.body_start_line + offset
            heading = re.match(r"^##\s+(.+?)\s*$", raw_line)
            if heading:
                current_section = normalize_heading(heading.group(1))
                continue
            if current_section not in CATALOGUE_SECTIONS or not raw_line.lstrip().startswith("-"):
                continue
            match = entry_re.match(raw_line)
            if not match:
                self.error("INDEX_ENTRY_FORMAT", index.path, "색인 항목은 `- [[페이지]] — 요약 (소스 N개)` 형식이어야 합니다.", line_no)
                continue
            inner, count_text = match.group(1), match.group(2)
            link_target = inner.split("|", 1)[0].split("#", 1)[0].strip()
            target, problem = self.resolve_page(link_target)
            if problem == "missing":
                self.error("INDEX_TARGET_MISSING", index.path, f"색인 대상이 없습니다: `[[{link_target}]]`", line_no)
                continue
            if problem == "ambiguous":
                self.error("INDEX_TARGET_AMBIGUOUS", index.path, f"색인 대상이 모호합니다: `[[{link_target}]]`", line_no)
                continue
            if target is None:
                continue
            if target.rel == "index.md":
                self.error("INDEX_SELF", index.path, "index.md 자신은 색인 항목으로 수록하지 않습니다.", line_no)
                continue
            if target.rel in listed:
                self.error("INDEX_DUPLICATE", index.path, f"`{target.rel}`이 색인에 중복 수록되었습니다.", line_no)
            else:
                listed[target.rel] = line_no

            expected_section = index_section_for_page(target)
            if current_section != expected_section:
                self.error("INDEX_SECTION", index.path, f"`{target.rel}`은 `## {expected_section}`에 수록해야 합니다.", line_no)
            actual_count = source_count(target)
            recorded_count = int(count_text)
            if actual_count is not None and actual_count != recorded_count:
                self.error("INDEX_SOURCE_COUNT", index.path, f"`{target.rel}`의 소스 수는 {actual_count}개이지만 {recorded_count}개로 기록되었습니다.", line_no)

        expected = {page.rel for page in self.pages if page.rel != "index.md"}
        missing = sorted(expected - set(listed), key=str.casefold)
        extra = sorted(set(listed) - expected, key=str.casefold)
        for rel in missing:
            self.error("INDEX_COVERAGE_MISSING", index.path, f"색인에 누락된 페이지입니다: `{rel}`")
        for rel in extra:
            self.error("INDEX_COVERAGE_EXTRA", index.path, f"존재하지 않는 색인 항목입니다: `{rel}`", listed[rel])

    def validate_log(self) -> None:
        log = self.page_by_rel.get("log.md")
        if log is None:
            self.error("LOG_MISSING", "wiki/log.md", "작업 로그 파일이 없습니다.")
            return
        for level, heading, line in log.headings:
            if level != 2 or normalize_heading(heading) == "관련 항목":
                continue
            if not re.fullmatch(r"\[\d{4}-\d{2}-\d{2}\] [a-z]+ \| .+", heading):
                self.error("LOG_HEADER_FORMAT", log.path, "로그 H2는 `## [YYYY-MM-DD] 작업유형 | 제목` 형식이어야 합니다.", line)
        entries = visible_log_entries(log.body)
        previous: date | None = None
        for start_line, groups, entry_text, visible_entry_text in entries:
            date_text, work_type, title = (group.strip() for group in groups)
            line = log.body_start_line + start_line
            try:
                parsed = datetime.strptime(date_text, "%Y-%m-%d").date()
            except ValueError:
                self.error("LOG_DATE", log.path, f"로그 날짜가 유효하지 않습니다: `{date_text}`", line)
                parsed = None
            if parsed and previous and parsed < previous:
                self.error("LOG_ORDER", log.path, "로그 항목은 날짜 오름차순으로 추가해야 합니다.", line)
            if parsed:
                previous = parsed
            if work_type not in LOG_TYPES:
                self.error("LOG_TYPE", log.path, f"작업유형 `{work_type}`은 통제어휘에 없습니다.", line)
            if not title:
                self.error("LOG_TITLE", log.path, "로그 제목이 비어 있습니다.", line)
            entry_lines = visible_entry_text.splitlines(keepends=True)
            entry_body = "".join(entry_lines[1:])
            if not re.search(r"^-\s+", entry_body, re.MULTILINE):
                self.error("LOG_CHANGE_LIST", log.path, "각 로그 항목에는 변경 내용을 나열한 불릿 목록이 필요합니다.", line)
            elif not re.search(r"\[\[[^\]]+\]\]|`[^`]*(?:\.md|wiki/|raw/|scripts/|\.github/)[^`]*`", entry_body):
                self.error("LOG_CHANGED_PAGES", log.path, "각 로그 항목의 불릿 목록에는 변경된 페이지·파일 경로나 위키링크가 필요합니다.", line)

    def validate_against_base(self, base: str) -> None:
        ok, _, stderr = run_git("rev-parse", "--verify", f"{base}^{{commit}}")
        if not ok:
            self.error("GIT_BASE", ".git", f"기준 Git 참조 `{base}`를 확인할 수 없습니다: {stderr.strip()}")
            return
        self.validate_raw_immutability(base)
        self.validate_raw_commit_history(base)
        self.validate_source_id_stability(base)
        self.validate_log_append_only(base)
        self.validate_wiki_log_update(base)

    def validate_raw_immutability(self, base: str) -> None:
        changes = git_name_status(base, "raw")
        if changes is None:
            self.error("GIT_DIFF", ".git", "raw 변경 내역을 읽을 수 없습니다.")
            return
        for status, paths in changes:
            if status == "A":
                continue
            joined = " -> ".join(paths)
            self.error("RAW_IMMUTABLE", joined, f"기준 `{base}`에 있던 raw 파일은 수정·삭제·이동할 수 없습니다(상태 {status}).")

    def validate_raw_commit_history(self, base: str) -> None:
        ok, output, stderr = run_git("rev-list", "--reverse", f"{base}..HEAD")
        if not ok:
            self.error("RAW_HISTORY_READ", ".git", f"기준 이후 커밋 목록을 읽을 수 없습니다: {stderr.strip()}")
            return
        for commit in (line.strip() for line in output.splitlines() if line.strip()):
            ok, parents_output, stderr = run_git("show", "-s", "--format=%P", commit)
            if not ok:
                self.error("RAW_HISTORY_READ", ".git", f"커밋 `{commit[:12]}`의 부모를 읽을 수 없습니다: {stderr.strip()}")
                continue
            parents = parents_output.strip().split()
            if not parents:
                continue
            changes = git_name_status_between(parents[0], commit, "raw")
            if changes is None:
                self.error("RAW_HISTORY_READ", ".git", f"커밋 `{commit[:12]}`의 raw 변경을 읽을 수 없습니다.")
                continue
            for status, paths in changes:
                if status == "A":
                    continue
                joined = " -> ".join(paths)
                self.error("RAW_HISTORY_IMMUTABLE", joined, f"커밋 `{commit[:12]}`에서 raw 파일을 수정·삭제·이동했습니다(상태 {status}). 기준 이후 각 커밋에는 새 파일 추가만 허용됩니다.")

    def validate_source_id_stability(self, base: str) -> None:
        ok, output, stderr = run_git("ls-tree", "-r", "--name-only", "-z", base, "--", "wiki/sources")
        if not ok:
            self.error("SOURCE_ID_BASE_READ", "wiki/sources", f"기준 출처 목록을 읽을 수 없습니다: {stderr.strip()}")
            return
        for rel in (item for item in output.split("\0") if item.endswith(".md")):
            ok, old_text, _ = run_git("show", f"{base}:{rel}")
            if not ok:
                continue
            old_id = frontmatter_scalar(old_text, "source_id")
            if not isinstance(old_id, str) or not old_id:
                continue
            current_rel = rel.removeprefix("wiki/")
            same_page = self.page_by_rel.get(current_rel)
            if same_page is not None and same_page.frontmatter.get("source_id") != old_id:
                self.error("SOURCE_ID_CHANGED", same_page.path, f"기준 `{base}`의 source_id `{old_id}`를 변경할 수 없습니다.", same_page.line_for("source_id"))
            if old_id not in self.source_by_id:
                self.error("SOURCE_ID_REMOVED", rel, f"기준 `{base}`의 source_id `{old_id}`가 현재 위키에서 사라졌습니다. 페이지를 이동해도 ID는 유지해야 합니다.")

    def validate_log_append_only(self, base: str) -> None:
        ok, output, stderr = run_git("show", f"{base}:wiki/log.md")
        if not ok:
            if "exists on disk" not in stderr and "does not exist" not in stderr and "Path 'wiki/log.md'" not in stderr:
                self.error("LOG_BASE_READ", "wiki/log.md", f"기준 로그를 읽을 수 없습니다: {stderr.strip()}")
            return
        current_path = WIKI / "log.md"
        if not current_path.is_file():
            return
        try:
            current = current_path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeDecodeError):
            return
        base_entries = extract_log_entries(output)
        current_entries = extract_log_entries(current)
        if len(current_entries) < len(base_entries):
            self.error("LOG_APPEND_DELETE", current_path, f"기준 로그 항목 {len(base_entries)}개 중 일부가 삭제되었습니다.")
            return
        for index, old in enumerate(base_entries):
            if current_entries[index] != old:
                header = old.splitlines()[0] if old else f"#{index + 1}"
                self.error("LOG_APPEND_CHANGED", current_path, f"기존 로그 항목을 수정하거나 순서를 바꿀 수 없습니다: `{header}`")

    def validate_wiki_log_update(self, base: str) -> None:
        changes = git_name_status(base, "wiki")
        if changes is None:
            self.error("GIT_DIFF", ".git", "wiki 변경 내역을 읽을 수 없습니다.")
            return
        changed_paths = {path for _, paths in changes for path in paths}
        ok, untracked, _ = run_git("ls-files", "--others", "--exclude-standard", "-z", "--", "wiki")
        if ok:
            changed_paths.update(item for item in untracked.split("\0") if item)
        content_changes = {path for path in changed_paths if path != "wiki/log.md"}
        if not content_changes:
            return
        if "wiki/log.md" not in changed_paths:
            self.error("LOG_UPDATE_REQUIRED", "wiki/log.md", "wiki 변경이 있으므로 log.md에 새 감사 항목을 추가해야 합니다.")
            return
        ok, base_log, _ = run_git("show", f"{base}:wiki/log.md")
        if not ok:
            return
        try:
            current_log = (WIKI / "log.md").read_text(encoding="utf-8-sig")
        except (OSError, UnicodeDecodeError):
            return
        base_entries = extract_log_entries(base_log)
        current_records = visible_log_entries(current_log)
        if len(current_records) <= len(base_entries):
            self.error("LOG_ENTRY_REQUIRED", "wiki/log.md", "frontmatter만 바꾸지 말고 새 작업 로그 항목을 추가해야 합니다.")
            return
        new_visible_text = "\n".join(record[3] for record in current_records[len(base_entries) :])
        uncovered = self.uncovered_log_changes(content_changes, new_visible_text)
        if uncovered:
            preview = ", ".join(f"`{path}`" for path in uncovered[:10])
            remainder = len(uncovered) - 10
            suffix = f" 외 {remainder}개" if remainder > 0 else ""
            self.error("LOG_CHANGE_COVERAGE", "wiki/log.md", f"새 로그 항목이 변경된 위키 파일을 기록하지 않았습니다: {preview}{suffix}")

    def uncovered_log_changes(self, changed_paths: set[str], visible_log_text: str) -> list[str]:
        exact_paths: set[str] = set()
        directory_prefixes: set[str] = set()

        for match in re.finditer(r"`([^`\n]+)`", visible_log_text):
            value = match.group(1).strip().replace("\\", "/").removeprefix("./")
            if value in {"index.md", "log.md", "overview.md"}:
                exact_paths.add(f"wiki/{value}")
                continue
            if not value.startswith("wiki/") or value == "wiki/":
                continue
            if value.endswith(".md"):
                exact_paths.add(PurePosixPath(value).as_posix())
                continue
            trimmed = value.rstrip("/")
            parts = PurePosixPath(trimmed).parts
            if len(parts) >= 2 and parts[0] == "wiki" and parts[1] in TYPE_BY_DIRECTORY and (value.endswith("/") or len(parts) == 2):
                directory_prefixes.add(f"{trimmed}/")

        for match in WIKILINK_RE.finditer(visible_log_text):
            inner = match.group(1) or match.group(2) or ""
            target_text = inner.split("|", 1)[0].split("#", 1)[0].strip()
            if not target_text:
                continue
            target, problem = self.resolve_page(target_text)
            if problem is None and target is not None:
                exact_paths.add(f"wiki/{target.rel}")

        uncovered: list[str] = []
        for path in sorted((item.replace("\\", "/") for item in changed_paths), key=str.casefold):
            if path in exact_paths:
                continue
            if any(path.startswith(prefix) for prefix in directory_prefixes):
                continue
            uncovered.append(path)
        return uncovered


def parse_yaml_value(raw: str) -> object:
    raw = strip_yaml_comment(raw.strip())
    if raw == "":
        return ""
    if raw.startswith(("[", "{")):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            if raw.startswith("{"):
                raise ValueError("인라인 매핑은 JSON 스타일의 큰따옴표 키·문자열만 지원합니다")
    if raw.startswith("["):
        if not raw.endswith("]"):
            raise ValueError("닫는 `]`가 없습니다")
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [parse_yaml_value(item.strip()) for item in split_flow_items(inner)]
    if raw.startswith("{"):
        raise ValueError("인라인 매핑은 지원하지 않습니다")
    if raw[0:1] == '"':
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            try:
                return ast.literal_eval(raw)
            except (ValueError, SyntaxError) as exc:
                raise ValueError("잘못된 큰따옴표 문자열") from exc
    if raw[0:1] == "'":
        if len(raw) < 2 or not raw.endswith("'"):
            raise ValueError("닫히지 않은 작은따옴표 문자열")
        inner = raw[1:-1]
        result: list[str] = []
        index = 0
        while index < len(inner):
            char = inner[index]
            if char != "'":
                result.append(char)
                index += 1
                continue
            if index + 1 < len(inner) and inner[index + 1] == "'":
                result.append("'")
                index += 2
                continue
            raise ValueError("작은따옴표 문자열 내부의 따옴표는 `''`로 이스케이프해야 합니다")
        return "".join(result)
    lower = raw.casefold()
    if lower in {"null", "~"}:
        return None
    if lower in {"true", "false"}:
        return lower == "true"
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    if re.search(r":\s", raw):
        raise ValueError("콜론 뒤 공백이 있는 문자열은 큰따옴표로 감싸세요")
    return raw


def frontmatter_scalar(text: str, key: str) -> object | None:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.splitlines()
    if not lines or lines[0].lstrip("\ufeff") != "---":
        return None
    try:
        end = lines.index("---", 1)
    except ValueError:
        return None
    pattern = re.compile(rf"^{re.escape(key)}:\s*(.*?)\s*$")
    for line in lines[1:end]:
        match = pattern.match(line)
        if match:
            try:
                return parse_yaml_value(match.group(1))
            except ValueError:
                return None
    return None


def split_flow_items(raw: str) -> list[str]:
    items: list[str] = []
    current: list[str] = []
    quote: str | None = None
    escaped = False
    delimiters: list[str] = []
    matching = {"]": "[", "}": "{"}
    for char in raw:
        if quote:
            current.append(char)
            if escaped:
                escaped = False
            elif char == "\\" and quote == '"':
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {'"', "'"}:
            quote = char
            current.append(char)
        elif char in "[{":
            delimiters.append(char)
            current.append(char)
        elif char in "]}":
            if not delimiters or delimiters[-1] != matching[char]:
                raise ValueError("흐름식 목록의 괄호 종류나 순서가 맞지 않습니다")
            delimiters.pop()
            current.append(char)
        elif char == "," and not delimiters:
            items.append("".join(current))
            current = []
        else:
            current.append(char)
    if quote:
        raise ValueError("닫히지 않은 따옴표가 있습니다")
    if delimiters:
        raise ValueError("괄호 짝이 맞지 않습니다")
    final = "".join(current)
    if final.strip() or not raw.rstrip().endswith(","):
        items.append(final)
    return items


def strip_yaml_comment(raw: str) -> str:
    if raw and raw[0] not in {'"', "'", "[", "{"}:
        for index, char in enumerate(raw):
            if char == "#" and index > 0 and raw[index - 1].isspace():
                return raw[:index].rstrip()
        return raw
    quote: str | None = None
    escaped = False
    for index, char in enumerate(raw):
        if quote:
            if escaped:
                escaped = False
            elif char == "\\" and quote == '"':
                escaped = True
            elif char == quote:
                quote = None
        elif char in {'"', "'"}:
            quote = char
        elif char == "#" and index > 0 and raw[index - 1].isspace():
            return raw[:index].rstrip()
    return raw


def contains_structured_value(value: object) -> bool:
    if isinstance(value, dict):
        return True
    return isinstance(value, list) and any(isinstance(item, (dict, list)) for item in value)


def expected_page_type(rel: str) -> str | None:
    parts = PurePosixPath(rel).parts
    if len(parts) > 1:
        return TYPE_BY_DIRECTORY.get(parts[0])
    return "meta" if rel in {"index.md", "log.md", "overview.md"} else None


def extract_headings(lines: list[str], first_line: int) -> list[tuple[int, str, int]]:
    result: list[tuple[int, str, int]] = []
    visible_lines = remove_fenced_code("\n".join(lines), strip_inline_code=False).splitlines()
    for offset, line in enumerate(visible_lines):
        match = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if match:
            result.append((len(match.group(1)), match.group(2).strip(), first_line + offset))
    return result


def remove_fenced_code(text: str, *, strip_inline_code: bool = True) -> str:
    output: list[str] = []
    in_fence = False
    fence_char = ""
    in_comment = False
    in_obsidian_comment = False
    for line in text.splitlines(keepends=True):
        fence = re.match(r"^\s*(`{3,}|~{3,})", line)
        if fence:
            chars = fence.group(1)
            if not in_fence:
                in_fence = True
                fence_char = chars[0]
            elif chars[0] == fence_char:
                in_fence = False
            output.append("\n" if line.endswith(("\n", "\r")) else "")
            continue
        if in_fence:
            output.append("\n" if line.endswith(("\n", "\r")) else "")
            continue
        visible = line
        if in_comment:
            if "-->" in visible:
                visible = visible.split("-->", 1)[1]
                in_comment = False
            else:
                output.append("\n" if line.endswith(("\n", "\r")) else "")
                continue
        if in_obsidian_comment:
            if "%%" in visible:
                visible = visible.split("%%", 1)[1]
                in_obsidian_comment = False
            else:
                output.append("\n" if line.endswith(("\n", "\r")) else "")
                continue
        while "<!--" in visible:
            before, after = visible.split("<!--", 1)
            if "-->" in after:
                visible = before + after.split("-->", 1)[1]
            else:
                visible = before
                in_comment = True
                break
        while "%%" in visible:
            before, after = visible.split("%%", 1)
            if "%%" in after:
                visible = before + after.split("%%", 1)[1]
            else:
                visible = before
                in_obsidian_comment = True
                break
        if strip_inline_code:
            visible = re.sub(r"`[^`\n]*`", "", visible)
        if line.endswith("\r\n") and not visible.endswith("\r\n"):
            visible += "\r\n"
        elif line.endswith("\n") and not visible.endswith("\n"):
            visible += "\n"
        output.append(visible)
    return "".join(output)


def normalize_identity(value: str) -> str:
    value = unicodedata.normalize("NFC", value.strip().replace("\\", "/"))
    return value.casefold()


def portable_path_key(value: str) -> str:
    return unicodedata.normalize("NFC", value.replace("\\", "/")).casefold()


def is_forbidden_raw_symlink(path: Path) -> bool:
    return path.is_symlink()


def normalize_heading(value: str) -> str:
    value = re.sub(r"\s+#+\s*$", "", value.strip())
    return unicodedata.normalize("NFC", value).casefold()


def require_nonempty_string(linter: Linter, page: Page, key: str) -> str | None:
    if key not in page.frontmatter:
        return None
    value = page.frontmatter[key]
    if not isinstance(value, str) or not value.strip():
        linter.error("FM_STRING", page.path, f"`{key}`는 비어 있지 않은 문자열이어야 합니다.", page.line_for(key))
        return None
    return value.strip()


def require_string_list(linter: Linter, page: Page, key: str) -> list[str]:
    if key not in page.frontmatter:
        return []
    value = page.frontmatter[key]
    if not isinstance(value, list):
        linter.error("FM_LIST", page.path, f"`{key}`는 목록이어야 합니다.", page.line_for(key))
        return []
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            linter.error("FM_LIST_STRING", page.path, f"`{key}`의 모든 항목은 비어 있지 않은 문자열이어야 합니다.", page.line_for(key))
            continue
        result.append(item.strip())
    return result


def optional_string_list(linter: Linter, page: Page, key: str) -> list[str]:
    if key not in page.frontmatter:
        return []
    return require_string_list(linter, page, key)


def validate_optional_enum(linter: Linter, page: Page, key: str, allowed: set[str]) -> str | None:
    if key not in page.frontmatter:
        return None
    value = page.frontmatter[key]
    if not isinstance(value, str) or value not in allowed:
        linter.error("FM_ENUM", page.path, f"`{key}`는 {sorted(allowed)} 중 하나여야 합니다.", page.line_for(key))
        return None
    return value


def first_normalization_difference_line(text: str) -> int:
    for number, line in enumerate(text.splitlines(), start=1):
        if line != unicodedata.normalize("NFC", line):
            return number
    return 1


def is_valid_date(value: str) -> bool:
    if not DATE_RE.fullmatch(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_version_pinned_law_url(url: str) -> bool:
    return bool(law_url_identifiers(url))


def law_url_identifiers(url: str) -> set[tuple[str, str]]:
    parsed = urlparse(url)
    host = (parsed.hostname or "").casefold().rstrip(".")
    if host != "law.go.kr" and not host.endswith(".law.go.kr"):
        return set()
    identifiers: set[tuple[str, str]] = set()
    for key, values in parse_qs(parsed.query).items():
        normalized_key = key.casefold()
        if normalized_key not in {"lsiseq", "ancno", "ancyd", "efyd"}:
            continue
        for value in values:
            if re.fullmatch(r"\d+", value):
                identifiers.add((normalized_key, value))
    return identifiers


def law_version_identifiers(version: str) -> set[tuple[str, str]]:
    return {
        (match.group(1).casefold(), match.group(2))
        for match in re.finditer(r"\b(lsiSeq|ancNo|ancYd|efYd)\s*=\s*(\d+)\b", version, re.IGNORECASE)
    }


def index_section_for_page(page: Page) -> str:
    if page.rel == "overview.md":
        return "홈"
    return INDEX_SECTION_BY_TYPE.get(page.expected_type, "메타")


def source_count(page: Page) -> int | None:
    if page.expected_type == "source":
        raw_sources = page.frontmatter.get("raw_sources")
        source_urls = page.frontmatter.get("source_urls")
        if not isinstance(raw_sources, list) or not isinstance(source_urls, list):
            return None
        return len(raw_sources) + len(source_urls)
    refs = page.frontmatter.get("source_refs")
    return len(refs) if isinstance(refs, list) else None


def visible_log_entries(text: str) -> list[tuple[int, tuple[str, str, str], str, str]]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    original_lines = normalized.splitlines(keepends=True)
    visible = remove_fenced_code(normalized, strip_inline_code=False)
    visible_lines = visible.splitlines(keepends=True)
    if len(visible_lines) < len(original_lines):
        visible_lines.extend([""] * (len(original_lines) - len(visible_lines)))

    headers: list[tuple[int, tuple[str, str, str]]] = []
    related_lines: list[int] = []
    for line_index, line in enumerate(visible_lines):
        candidate = line.rstrip("\n")
        match = ANY_LOG_HEADER_RE.fullmatch(candidate)
        if match:
            headers.append((line_index, match.groups()))
        elif re.fullmatch(r"##\s+관련 항목\s*", candidate):
            related_lines.append(line_index)

    entries: list[tuple[int, tuple[str, str, str], str, str]] = []
    for index, (start, groups) in enumerate(headers):
        end = headers[index + 1][0] if index + 1 < len(headers) else len(original_lines)
        related_after = [line for line in related_lines if start < line < end]
        if related_after:
            end = related_after[0]
        entries.append((start, groups, "".join(original_lines[start:end]), "".join(visible_lines[start:end])))
    return entries


def extract_log_entries(text: str) -> list[str]:
    return [entry for _, _, entry, _ in visible_log_entries(text)]


def run_git(*args: str) -> tuple[bool, str, str]:
    process = subprocess.run(
        ["git", "-C", str(ROOT), "-c", "core.quotepath=false", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return (
        process.returncode == 0,
        process.stdout.decode("utf-8", errors="replace"),
        process.stderr.decode("utf-8", errors="replace"),
    )


def git_name_status(base: str, pathspec: str) -> list[tuple[str, list[str]]] | None:
    ok, output, _ = run_git("diff", "--name-status", "-z", "--find-renames", base, "--", pathspec)
    if not ok:
        return None
    return parse_name_status(output)


def git_name_status_between(old: str, new: str, pathspec: str) -> list[tuple[str, list[str]]] | None:
    ok, output, _ = run_git("diff", "--name-status", "-z", "--find-renames", old, new, "--", pathspec)
    if not ok:
        return None
    return parse_name_status(output)


def parse_name_status(output: str) -> list[tuple[str, list[str]]] | None:
    tokens = output.split("\0")
    if tokens and tokens[-1] == "":
        tokens.pop()
    changes: list[tuple[str, list[str]]] = []
    index = 0
    while index < len(tokens):
        status_token = tokens[index]
        index += 1
        status = status_token[:1]
        count = 2 if status in {"R", "C"} else 1
        if index + count > len(tokens):
            return None
        paths = tokens[index : index + count]
        index += count
        changes.append((status, paths))
    return changes


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="대한민국 노동법 위키의 구조와 출처 계보를 검사합니다.")
    parser.add_argument("--base", help="추가로 raw 불변성·로그 append-only를 비교할 Git 기준점")
    parser.add_argument("--strict-warnings", action="store_true", help="경고가 하나라도 있으면 실패합니다")
    return parser


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args()
    return Linter(base=args.base, strict_warnings=args.strict_warnings).run()


if __name__ == "__main__":
    sys.exit(main())
