"""Parse YAML frontmatter from Markdown files."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import yaml


@dataclass
class FrontmatterData:
    """Structured frontmatter fields for knowledge base documents."""

    title: str | None = None
    category: str | None = None
    tags: list[str] = field(default_factory=list)
    difficulty: str | None = None
    pack_id: str | None = None


_FRONTMATTER_RE = re.compile(
    r"\A---[ \t]*\r?\n(.*?)---[ \t]*\r?\n?",
    re.DOTALL,
)


def parse_frontmatter(text: str) -> tuple[FrontmatterData, str]:
    """Parse YAML frontmatter from text.

    Returns (FrontmatterData, body) where body is the text after the
    frontmatter block. If no valid frontmatter is found, returns
    default FrontmatterData and the original text unchanged.
    """
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return FrontmatterData(), text

    yaml_block = match.group(1)
    body = text[match.end():]

    try:
        parsed = yaml.safe_load(yaml_block)
    except yaml.YAMLError:
        return FrontmatterData(), body

    if not isinstance(parsed, dict):
        return FrontmatterData(), body

    # Normalize tags: string → single-element list
    tags_raw = parsed.get("tags", [])
    if isinstance(tags_raw, str):
        tags = [tags_raw]
    elif isinstance(tags_raw, list):
        tags = [str(t) for t in tags_raw]
    else:
        tags = []

    data = FrontmatterData(
        title=parsed.get("title"),
        category=parsed.get("category"),
        tags=tags,
        difficulty=parsed.get("difficulty"),
        pack_id=parsed.get("pack_id"),
    )
    return data, body
