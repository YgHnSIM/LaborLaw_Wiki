import importlib.util
from pathlib import Path
import sys
import unittest


LINTER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "lint_wiki.py"
SPEC = importlib.util.spec_from_file_location("lint_wiki_under_test", LINTER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"린터 모듈을 불러올 수 없습니다: {LINTER_PATH}")
LINTER_MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = LINTER_MODULE
SPEC.loader.exec_module(LINTER_MODULE)

Linter = LINTER_MODULE.Linter
parse_yaml_value = LINTER_MODULE.parse_yaml_value
strip_yaml_comment = LINTER_MODULE.strip_yaml_comment


class FrontmatterParserTests(unittest.TestCase):
    def test_json_style_case_decisions_are_supported(self) -> None:
        value = parse_yaml_value(
            '[{"case_number": "2026부해1", "decision_date": "2026-06-15", '
            '"court": "울산지방노동위원회", "event_status": "decided"}]'
        )
        self.assertEqual(value[0]["case_number"], "2026부해1")
        self.assertEqual(value[0]["decision_date"], "2026-06-15")

    def test_block_list_can_contain_json_style_mapping(self) -> None:
        linter = Linter(base=None, strict_warnings=False)
        frontmatter, _ = linter.parse_frontmatter(
            Path("sample.md"),
            [
                "case_decisions:",
                '  - {"case_number": "2026부해1", "decision_date": "2026-06-15"}',
            ],
            start_line=2,
        )
        self.assertEqual(frontmatter["case_decisions"][0]["case_number"], "2026부해1")
        self.assertEqual(linter.diagnostics, [])

    def test_json_mapping_is_limited_to_case_decisions(self) -> None:
        linter = Linter(base=None, strict_warnings=False)
        linter.parse_frontmatter(
            Path("sample.md"),
            ['aliases: [{"name": "Alias"}]'],
            start_line=2,
        )
        self.assertEqual([item.code for item in linter.diagnostics], ["FM_MAPPING_SCOPE"])

    def test_mismatched_flow_delimiters_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            parse_yaml_value("[a},b{]")

    def test_single_quoted_yaml_escape_is_supported(self) -> None:
        self.assertEqual(parse_yaml_value("'it''s'"), "it's")
        self.assertEqual(parse_yaml_value(r"'C:\tmp'"), r"C:\tmp")

    def test_lone_quote_in_single_quoted_scalar_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            parse_yaml_value(r"'bad\'quote'")

    def test_apostrophe_in_plain_scalar_does_not_hide_comment(self) -> None:
        self.assertEqual(strip_yaml_comment("Workers' Press # publication"), "Workers' Press")


if __name__ == "__main__":
    unittest.main()
