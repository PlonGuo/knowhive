from knowhive_pdf.mapping import (
    heading_level_from_numbering,
    normalize_text,
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
