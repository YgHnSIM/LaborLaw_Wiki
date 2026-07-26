"""Parse the repository's dependency-free YAML frontmatter subset.

The wiki deliberately supports a small YAML-compatible grammar so validation
and maintenance commands can run without third-party packages.  Keep the
grammar in this module so those commands cannot silently interpret the same
frontmatter differently.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
import json
import re


KEY_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_]*):(?:[ \t]*(.*))?$")
STRUCTURED_FIELDS = frozenset({"case_decisions", "source_relations"})


@dataclass(frozen=True)
class FrontmatterIssue:
    code: str
    message: str
    line: int


def parse_frontmatter_lines(
    lines: list[str],
    *,
    start_line: int = 1,
) -> tuple[dict[str, object], dict[str, int], list[FrontmatterIssue]]:
    """Parse frontmatter body lines and return values, key lines, and issues."""

    result: dict[str, object] = {}
    key_lines: dict[str, int] = {}
    issues: list[FrontmatterIssue] = []
    index = 0

    def add_issue(code: str, message: str, line: int) -> None:
        issues.append(FrontmatterIssue(code, message, line))

    while index < len(lines):
        raw_line = lines[index]
        line_no = start_line + index
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            index += 1
            continue
        leading = raw_line[: len(raw_line) - len(raw_line.lstrip(" \t"))]
        if "\t" in leading:
            add_issue("FM_TAB_INDENT", "YAML 들여쓰기에 탭을 사용할 수 없습니다.", line_no)
            index += 1
            continue
        if raw_line.startswith((" ", "\t")):
            add_issue("FM_INDENT", "최상위 프론트매터 키에 들여쓰기를 사용할 수 없습니다.", line_no)
            index += 1
            continue
        match = KEY_RE.match(raw_line)
        if not match:
            add_issue("FM_SYNTAX", "지원하지 않는 프론트매터 문법입니다.", line_no)
            index += 1
            continue

        key, raw_value = match.group(1), match.group(2) or ""
        if key in result:
            add_issue("FM_DUPLICATE_KEY", f"중복 키 `{key}`가 있습니다.", line_no)
        key_lines[key] = line_no
        if raw_value.strip():
            try:
                value = parse_yaml_value(raw_value.strip())
            except ValueError as exc:
                add_issue("FM_VALUE", f"`{key}` 값을 해석할 수 없습니다: {exc}", line_no)
                value = raw_value.strip()
            if key not in STRUCTURED_FIELDS and contains_structured_value(value):
                add_issue(
                    "FM_MAPPING_SCOPE",
                    "JSON 스타일 인라인 매핑은 case_decisions·source_relations에서만 사용할 수 있습니다.",
                    line_no,
                )
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
                add_issue("FM_TAB_INDENT", "YAML 목록 들여쓰기에 탭을 사용할 수 없습니다.", child_no)
                cursor += 1
                continue
            item_match = re.match(r"^[ \t]+-[ \t]*(.*)$", child)
            if not item_match:
                add_issue("FM_NESTING", f"`{key}`에는 단순 목록만 사용할 수 있습니다.", child_no)
                cursor += 1
                continue
            try:
                values.append(parse_yaml_value(item_match.group(1).strip()))
                saw_item = True
            except ValueError as exc:
                add_issue("FM_VALUE", f"`{key}` 목록 값을 해석할 수 없습니다: {exc}", child_no)
            cursor += 1
        value = values if saw_item else None
        if key not in STRUCTURED_FIELDS and contains_structured_value(value):
            add_issue(
                "FM_MAPPING_SCOPE",
                "JSON 스타일 인라인 매핑은 case_decisions·source_relations에서만 사용할 수 있습니다.",
                line_no,
            )
        result[key] = value
        index = cursor

    return result, key_lines, issues


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
