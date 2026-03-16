"""Tests for frontmatter parser."""

import pytest

from app.services.frontmatter_parser import FrontmatterData, parse_frontmatter


class TestFrontmatterData:
    """Tests for FrontmatterData dataclass defaults."""

    def test_defaults(self):
        data = FrontmatterData()
        assert data.title is None
        assert data.category is None
        assert data.tags == []
        assert data.difficulty is None
        assert data.pack_id is None

    def test_all_fields(self):
        data = FrontmatterData(
            title="Two Sum",
            category="arrays",
            tags=["easy", "hashmap"],
            difficulty="easy",
            pack_id="leetcode-basics",
        )
        assert data.title == "Two Sum"
        assert data.category == "arrays"
        assert data.tags == ["easy", "hashmap"]
        assert data.difficulty == "easy"
        assert data.pack_id == "leetcode-basics"


class TestParseFrontmatter:
    """Tests for parse_frontmatter function."""

    def test_valid_frontmatter(self):
        text = (
            "---\n"
            "title: Two Sum\n"
            "category: arrays\n"
            "tags:\n"
            "  - easy\n"
            "  - hashmap\n"
            "difficulty: easy\n"
            "pack_id: leetcode-basics\n"
            "---\n"
            "# Two Sum\n\n"
            "Given an array of integers..."
        )
        data, body = parse_frontmatter(text)
        assert data.title == "Two Sum"
        assert data.category == "arrays"
        assert data.tags == ["easy", "hashmap"]
        assert data.difficulty == "easy"
        assert data.pack_id == "leetcode-basics"
        assert body == "# Two Sum\n\nGiven an array of integers..."

    def test_partial_frontmatter(self):
        text = "---\ntitle: Only Title\n---\nBody here."
        data, body = parse_frontmatter(text)
        assert data.title == "Only Title"
        assert data.category is None
        assert data.tags == []
        assert data.difficulty is None
        assert data.pack_id is None
        assert body == "Body here."

    def test_no_frontmatter(self):
        text = "# Just a heading\n\nSome content."
        data, body = parse_frontmatter(text)
        assert data == FrontmatterData()
        assert body == text

    def test_empty_frontmatter(self):
        text = "---\n---\nBody after empty frontmatter."
        data, body = parse_frontmatter(text)
        assert data == FrontmatterData()
        assert body == "Body after empty frontmatter."

    def test_malformed_yaml(self):
        text = "---\ntitle: [unclosed bracket\n---\nBody here."
        data, body = parse_frontmatter(text)
        assert data == FrontmatterData()
        assert body == "Body here."

    def test_frontmatter_must_start_at_beginning(self):
        text = "Some preamble\n---\ntitle: Nope\n---\nBody."
        data, body = parse_frontmatter(text)
        assert data == FrontmatterData()
        assert body == text

    def test_tags_as_inline_list(self):
        text = "---\ntags: [dp, greedy]\n---\nBody."
        data, body = parse_frontmatter(text)
        assert data.tags == ["dp", "greedy"]
        assert body == "Body."

    def test_tags_as_string_becomes_single_element_list(self):
        text = "---\ntags: solo\n---\nBody."
        data, body = parse_frontmatter(text)
        assert data.tags == ["solo"]
        assert body == "Body."

    def test_extra_fields_ignored(self):
        text = "---\ntitle: X\nauthor: Someone\ncustom: value\n---\nBody."
        data, body = parse_frontmatter(text)
        assert data.title == "X"
        assert not hasattr(data, "author")
        assert body == "Body."

    def test_empty_string_input(self):
        data, body = parse_frontmatter("")
        assert data == FrontmatterData()
        assert body == ""

    def test_only_frontmatter_no_body(self):
        text = "---\ntitle: No Body\n---\n"
        data, body = parse_frontmatter(text)
        assert data.title == "No Body"
        assert body == ""

    def test_body_with_triple_dashes(self):
        """Triple dashes in body should not be confused with frontmatter end."""
        text = "---\ntitle: Test\n---\nSome text\n---\nMore text after dashes."
        data, body = parse_frontmatter(text)
        assert data.title == "Test"
        assert body == "Some text\n---\nMore text after dashes."

    def test_windows_line_endings(self):
        text = "---\r\ntitle: Windows\r\n---\r\nBody with CRLF."
        data, body = parse_frontmatter(text)
        assert data.title == "Windows"
        assert "Body with CRLF." in body
