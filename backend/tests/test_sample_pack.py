"""Tests for sample knowledge pack fixtures (Task 108)."""

import json
from pathlib import Path

import pytest

from app.services.frontmatter_parser import parse_frontmatter

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SAMPLE_PACK_DIR = FIXTURES_DIR / "sample_pack"
EVAL_DATASET_PATH = FIXTURES_DIR / "eval_dataset.json"


class TestSamplePackFiles:
    """Verify sample_pack .md files exist and have valid frontmatter."""

    def test_sample_pack_directory_exists(self):
        assert SAMPLE_PACK_DIR.is_dir()

    def test_at_least_five_md_files(self):
        md_files = list(SAMPLE_PACK_DIR.glob("*.md"))
        assert len(md_files) >= 5, f"Expected >=5 .md files, got {len(md_files)}"

    def test_all_files_are_valid_markdown(self):
        for md_file in SAMPLE_PACK_DIR.glob("*.md"):
            text = md_file.read_text(encoding="utf-8")
            assert len(text) > 100, f"{md_file.name} is too short"

    def test_all_files_have_frontmatter(self):
        for md_file in SAMPLE_PACK_DIR.glob("*.md"):
            text = md_file.read_text(encoding="utf-8")
            fm, body = parse_frontmatter(text)
            assert fm.title is not None, f"{md_file.name} missing title"
            assert fm.category is not None, f"{md_file.name} missing category"
            assert len(fm.tags) > 0, f"{md_file.name} missing tags"
            assert fm.difficulty is not None, f"{md_file.name} missing difficulty"
            assert fm.pack_id == "leetcode-fundamentals", (
                f"{md_file.name} pack_id={fm.pack_id}"
            )

    def test_difficulty_values_are_valid(self):
        valid = {"easy", "medium", "hard"}
        for md_file in SAMPLE_PACK_DIR.glob("*.md"):
            text = md_file.read_text(encoding="utf-8")
            fm, _ = parse_frontmatter(text)
            assert fm.difficulty in valid, (
                f"{md_file.name} difficulty={fm.difficulty} not in {valid}"
            )

    def test_body_contains_heading(self):
        for md_file in SAMPLE_PACK_DIR.glob("*.md"):
            text = md_file.read_text(encoding="utf-8")
            _, body = parse_frontmatter(text)
            assert body.strip().startswith("#"), (
                f"{md_file.name} body does not start with a heading"
            )

    def test_pack_id_consistent(self):
        pack_ids = set()
        for md_file in SAMPLE_PACK_DIR.glob("*.md"):
            text = md_file.read_text(encoding="utf-8")
            fm, _ = parse_frontmatter(text)
            pack_ids.add(fm.pack_id)
        assert pack_ids == {"leetcode-fundamentals"}


class TestEvalDataset:
    """Verify eval_dataset.json exists and is valid."""

    def test_eval_dataset_exists(self):
        assert EVAL_DATASET_PATH.is_file()

    def test_eval_dataset_valid_json(self):
        data = json.loads(EVAL_DATASET_PATH.read_text(encoding="utf-8"))
        assert isinstance(data, list)

    def test_eval_dataset_has_enough_entries(self):
        data = json.loads(EVAL_DATASET_PATH.read_text(encoding="utf-8"))
        assert len(data) >= 10, f"Expected >=10 entries, got {len(data)}"

    def test_eval_dataset_entry_schema(self):
        data = json.loads(EVAL_DATASET_PATH.read_text(encoding="utf-8"))
        for i, entry in enumerate(data):
            assert "question" in entry, f"Entry {i} missing 'question'"
            assert "ground_truth" in entry, f"Entry {i} missing 'ground_truth'"
            assert isinstance(entry["question"], str)
            assert isinstance(entry["ground_truth"], str)
            assert len(entry["question"]) > 10, f"Entry {i} question too short"
            assert len(entry["ground_truth"]) > 10, f"Entry {i} ground_truth too short"
