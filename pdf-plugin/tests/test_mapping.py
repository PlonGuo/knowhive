from knowhive_pdf.mapping import (
    heading_level_from_numbering,
    normalize_text,
    refine_chinese_heading_levels,
    split_table_markdown,
)


def test_heading_levels_from_numbering():
    assert heading_level_from_numbering("3 BERT") == 2
    assert heading_level_from_numbering("3.1 Pre-training") == 3
    assert heading_level_from_numbering("3.2.1 Scaled Dot-Product Attention") == 4
    assert heading_level_from_numbering("Abstract") == 2
    assert heading_level_from_numbering("A.1 Appendix") == 2  # non-numeric → default


def test_nfkc_folds_kangxi_radicals():
    # Subsetted CJK fonts emit ⼀ (U+2F00) for 一 (U+4E00) — retrieval-fatal.
    assert normalize_text("⼀、⽗⼦切分") == "一、父子切分"
    assert normalize_text("⼆、⽰例") == "二、示例"


def test_table_caption_splits_off():
    md = "Table 1: results overview.\n\n| a | b |\n|---|---|\n| 1 | 2 |"
    caption, table = split_table_markdown(md)
    assert caption == "Table 1: results overview."
    assert table.split("\n")[0] == "| a | b |"
    assert table.split("\n")[1] == "|---|---|"


def test_table_without_pipes_becomes_caption_only():
    caption, table = split_table_markdown("just a stray caption")
    assert caption == "just a stray caption"
    assert table == ""


def _h(text: str) -> dict:
    return {"type": "heading", "text": text, "level": 2}


def test_chinese_official_numbering_gets_three_levels():
    blocks = [
        _h("一、人工智能发展概述"),
        _h("(一)全球不断升级人工智能战略"),
        _h("1. 新算法不断涌现"),
        _h("二、技术演进"),
        {"type": "paragraph", "text": "正文"},
    ]
    refine_chinese_heading_levels(blocks)
    assert [b["level"] for b in blocks if b["type"] == "heading"] == [2, 3, 4, 2]


def test_arabic_numbering_untouched_without_chinese_chapters():
    # "1. Introduction" in an English paper stays chapter-level: the Chinese
    # scheme only activates when 一、-style headings exist in the document.
    blocks = [_h("1. Introduction"), _h("2. Background")]
    refine_chinese_heading_levels(blocks)
    assert [b["level"] for b in blocks] == [2, 2]
