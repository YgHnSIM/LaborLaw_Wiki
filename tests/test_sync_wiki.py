import importlib.util
from pathlib import Path
import tempfile
import unittest


SYNC_PATH = Path(__file__).resolve().parents[1] / "scripts" / "sync_wiki.py"
SPEC = importlib.util.spec_from_file_location("sync_wiki_under_test", SYNC_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"색인 동기화 모듈을 불러올 수 없습니다: {SYNC_PATH}")
SYNC_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC_MODULE)


class SyncFrontmatterTests(unittest.TestCase):
    def test_shared_parser_preserves_quoted_commas_and_block_lists(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wiki_root = Path(directory) / "wiki"
            page = wiki_root / "meta" / "sample.md"
            page.parent.mkdir(parents=True)
            page.write_text(
                "\n".join(
                    [
                        "---",
                        'title: "샘플"',
                        'aliases: ["첫 별칭", "쉼표, 포함"]',
                        "tags:",
                        "  - type/meta",
                        "  - domain/labor-law",
                        "  - status/active",
                        "source_refs: []",
                        "---",
                        "",
                        "# 샘플",
                    ]
                ),
                encoding="utf-8",
            )

            parsed = SYNC_MODULE.parse_page(page, wiki_root=wiki_root)

        self.assertEqual(parsed["aliases"], ["첫 별칭", "쉼표, 포함"])
        self.assertEqual(parsed["tags"], ["type/meta", "domain/labor-law", "status/active"])
        self.assertEqual(parsed["relative"], "meta/sample.md")

    def test_invalid_structured_field_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wiki_root = Path(directory) / "wiki"
            page = wiki_root / "meta" / "sample.md"
            page.parent.mkdir(parents=True)
            page.write_text(
                "---\naliases: [{\"name\": \"별칭\"}]\n---\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "FM_MAPPING_SCOPE"):
                SYNC_MODULE.parse_page(page, wiki_root=wiki_root)

    def test_page_types_and_sections_come_from_the_shared_schema(self) -> None:
        self.assertEqual(SYNC_MODULE.type_for("cases/sample.md"), "case")
        self.assertEqual(SYNC_MODULE.section_name("case"), "사건")
        self.assertEqual(SYNC_MODULE.type_for("overview.md"), "meta")

    def test_instruction_files_are_not_catalogued(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wiki_root = Path(directory) / "wiki"
            wiki_root.mkdir()
            (wiki_root / "AGENTS.md").write_text("# instructions\n", encoding="utf-8")
            (wiki_root / "meta").mkdir()
            page = wiki_root / "meta" / "sample.md"
            page.write_text("---\ntitle: 샘플\n---\n", encoding="utf-8")

            paths = SYNC_MODULE.page_paths(wiki_root)

        self.assertEqual([path.relative_to(wiki_root).as_posix() for path in paths], ["meta/sample.md"])


if __name__ == "__main__":
    unittest.main()
