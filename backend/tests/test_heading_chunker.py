"""Tests for heading-aware chunker — split_by_headings with merge/sub-split logic."""
import pytest
from langchain_core.documents import Document

from app.services.heading_chunker import split_by_headings


class TestSplitByHeadings:
    """Test split_by_headings function."""

    def test_import(self):
        """Module and function are importable."""
        from app.services.heading_chunker import split_by_headings
        assert callable(split_by_headings)

    def test_returns_list_of_documents(self):
        """Returns a list of langchain Document objects."""
        text = "## Section 1\n\nSome content here."
        result = split_by_headings(text)
        assert isinstance(result, list)
        assert all(isinstance(doc, Document) for doc in result)

    def test_single_section(self):
        """A single heading section produces one chunk."""
        text = "## Section 1\n\nThis is the content of section one."
        result = split_by_headings(text)
        assert len(result) == 1
        assert "This is the content of section one." in result[0].page_content

    def test_multiple_sections(self):
        """Multiple ## headings produce multiple chunks."""
        text = (
            "## Intro\n\nIntro content here with enough words to make this section longer than the minimum merge threshold of one hundred characters.\n\n"
            "## Details\n\nDetails content here with enough words to make this section longer than the minimum merge threshold of one hundred characters.\n\n"
            "## Conclusion\n\nConclusion content here with enough words to make this section longer than the minimum merge threshold of one hundred characters."
        )
        result = split_by_headings(text)
        assert len(result) == 3
        assert "Intro content here" in result[0].page_content
        assert "Details content here" in result[1].page_content
        assert "Conclusion content here" in result[2].page_content

    def test_section_heading_metadata(self):
        """Each chunk has section_heading metadata."""
        text = "## My Section\n\nContent under my section."
        result = split_by_headings(text)
        assert result[0].metadata["section_heading"] == "My Section"

    def test_chunk_index_metadata(self):
        """Each chunk has chunk_index metadata starting from 0."""
        text = (
            "## A\n\nContent A.\n\n"
            "## B\n\nContent B.\n\n"
            "## C\n\nContent C."
        )
        result = split_by_headings(text)
        for i, doc in enumerate(result):
            assert doc.metadata["chunk_index"] == i

    def test_custom_metadata_passed_through(self):
        """Custom metadata dict is merged into each chunk."""
        text = "## Section\n\nContent."
        meta = {"file_path": "/foo/bar.md", "pack_id": "leetcode"}
        result = split_by_headings(text, metadata=meta)
        assert result[0].metadata["file_path"] == "/foo/bar.md"
        assert result[0].metadata["pack_id"] == "leetcode"
        assert result[0].metadata["section_heading"] == "Section"

    def test_preamble_before_first_heading(self):
        """Text before the first heading is included as a chunk."""
        text = (
            "This is preamble text before any heading. It has enough content to exceed the minimum section length threshold of one hundred characters easily.\n\n"
            "## First Section\n\nSection content that is also long enough to exceed the minimum section length threshold of one hundred characters easily."
        )
        result = split_by_headings(text)
        assert len(result) == 2
        assert "preamble text" in result[0].page_content
        assert result[0].metadata["section_heading"] == ""

    def test_short_sections_merged(self):
        """Sections shorter than 100 chars are merged with the next section."""
        text = (
            "## Short\n\nTiny.\n\n"
            "## Normal\n\nThis section has a reasonable amount of content that should stand on its own as a chunk."
        )
        result = split_by_headings(text)
        # Short section merged into normal → single chunk
        assert len(result) == 1
        assert "Tiny." in result[0].page_content
        assert "reasonable amount" in result[0].page_content

    def test_long_section_sub_split(self):
        """Sections longer than 1500 chars are sub-split into smaller chunks."""
        long_content = "This is a sentence with some words. " * 100  # ~3600 chars
        text = f"## Long Section\n\n{long_content}"
        result = split_by_headings(text)
        assert len(result) > 1
        # All sub-chunks inherit the section heading
        for doc in result:
            assert doc.metadata["section_heading"] == "Long Section"

    def test_heading_levels_h2_and_h3(self):
        """Both ## and ### headings trigger splits."""
        text = (
            "## Main Section\n\nMain content with enough words to stand on its own as a reasonable chunk that exceeds the minimum threshold.\n\n"
            "### Subsection\n\nSub content with enough words to also stand on its own as a reasonable chunk that exceeds the minimum threshold."
        )
        result = split_by_headings(text)
        assert len(result) == 2
        assert result[0].metadata["section_heading"] == "Main Section"
        assert result[1].metadata["section_heading"] == "Subsection"

    def test_h1_heading_triggers_split(self):
        """# headings also trigger splits."""
        text = (
            "# Title\n\nTitle content is here with enough words to be a standalone chunk on its own exceeding the minimum threshold.\n\n"
            "## Section\n\nSection content is here with enough words to be a standalone chunk on its own exceeding the minimum threshold."
        )
        result = split_by_headings(text)
        assert len(result) == 2

    def test_empty_text(self):
        """Empty text returns empty list."""
        result = split_by_headings("")
        assert result == []

    def test_whitespace_only(self):
        """Whitespace-only text returns empty list."""
        result = split_by_headings("   \n\n  ")
        assert result == []

    def test_no_headings(self):
        """Text without headings returns a single chunk."""
        text = "Just some plain text without any markdown headings at all."
        result = split_by_headings(text)
        assert len(result) == 1
        assert "plain text" in result[0].page_content
        assert result[0].metadata["section_heading"] == ""

    def test_metadata_default_empty(self):
        """When no metadata passed, only section_heading and chunk_index are set."""
        text = "## S\n\nContent that is long enough to not get merged away into nothing at all."
        result = split_by_headings(text)
        assert set(result[0].metadata.keys()) == {"section_heading", "chunk_index"}

    def test_heading_with_extra_hashes(self):
        """#### headings also work (any level)."""
        text = "#### Deep Heading\n\nDeep content that is long enough to stand alone as a chunk here."
        result = split_by_headings(text)
        assert len(result) == 1
        assert result[0].metadata["section_heading"] == "Deep Heading"

    def test_multiple_short_sections_merged_chain(self):
        """Multiple consecutive short sections are merged together."""
        text = (
            "## A\n\nTiny A.\n\n"
            "## B\n\nTiny B.\n\n"
            "## C\n\nThis section C has enough content to be a reasonable standalone chunk with good amount of text."
        )
        result = split_by_headings(text)
        # A and B merged into C
        assert len(result) == 1
        assert "Tiny A." in result[0].page_content
        assert "Tiny B." in result[0].page_content

    def test_sub_split_preserves_chunk_index(self):
        """Sub-split chunks have sequential chunk_index values."""
        long_content = "Word " * 400  # ~2000 chars
        text = (
            "## Short\n\nBrief intro content that is enough to stand alone.\n\n"
            f"## Long\n\n{long_content}"
        )
        result = split_by_headings(text)
        for i, doc in enumerate(result):
            assert doc.metadata["chunk_index"] == i
