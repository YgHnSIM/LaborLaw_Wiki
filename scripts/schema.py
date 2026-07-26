"""Shared v2 schema constants for the Python validator and maintenance tools."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schema" / "wiki-v2.json"


def load_schema() -> dict[str, object]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


SCHEMA = load_schema()
PAGE_TYPES = SCHEMA["page_types"]
TYPE_BY_DIRECTORY = {meta["directory"]: page_type for page_type, meta in PAGE_TYPES.items()}
INDEX_SECTION_BY_TYPE = {page_type: meta["index_section"] for page_type, meta in PAGE_TYPES.items()}
STATUS_VALUES = set(SCHEMA["status"])
LEGAL_AREAS = set(SCHEMA["legal_areas"])
AUTHORITIES = set(SCHEMA["authorities"])
SOURCE_TYPES = set(SCHEMA["source_types"])
RECORD_STATUSES = set(SCHEMA["record_status"])
NORMATIVE_STATUSES = set(SCHEMA["normative_status"])
CONFIDENCE_VALUES = set(SCHEMA["confidence"])
EVENT_STATUSES = set(SCHEMA["event_status"])
OPEN_EVENT_STATUSES = set(SCHEMA["open_event_status"])
SOURCE_RELATION_TYPES = set(SCHEMA["source_relation_types"])
CITATION_PATTERN = str(SCHEMA["citation_pattern"])
HIGH_RISK_PATTERN = str(SCHEMA["high_risk_pattern"])
SUMMARY_LENGTH = SCHEMA["required_summary_length"]
SUMMARY_MIN_LENGTH = int(SUMMARY_LENGTH["min"])
SUMMARY_MAX_LENGTH = int(SUMMARY_LENGTH["max"])
RAW_REMOVAL_MANIFEST = str(SCHEMA["raw_removal_manifest"])
