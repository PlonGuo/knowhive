"""Heading-aware chunker — splits Markdown by headings with merge/sub-split logic."""
import re
from typing import Optional

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Sections shorter than this are merged with the next section
MIN_SECTION_LENGTH = 100
# Sections longer than this are sub-split
MAX_SECTION_LENGTH = 1500

# Regex: match lines starting with one or more # followed by space
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)

# Sub-splitter for long sections
_sub_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
)


def split_by_headings(
    text: str,
    metadata: Optional[dict] = None,
) -> list[Document]:
    """Split Markdown text by headings into Documents.

    - Splits on any heading level (# through ######)
    - Merges short sections (<100 chars) with the next section
    - Sub-splits long sections (>1500 chars) using RecursiveCharacterTextSplitter
    - Adds section_heading and chunk_index to each Document's metadata
    """
    if not text or not text.strip():
        return []

    base_meta = metadata or {}

    # Parse into (heading, body) sections
    sections = _parse_sections(text)

    # Merge short sections
    sections = _merge_short_sections(sections)

    # Build documents with sub-splitting for long sections
    docs: list[Document] = []
    chunk_index = 0

    for heading, body in sections:
        body = body.strip()
        if not body:
            continue

        if len(body) > MAX_SECTION_LENGTH:
            # Sub-split long section
            sub_docs = _sub_splitter.create_documents(
                [body], metadatas=[{**base_meta, "section_heading": heading}]
            )
            for sub_doc in sub_docs:
                sub_doc.metadata["chunk_index"] = chunk_index
                docs.append(sub_doc)
                chunk_index += 1
        else:
            doc = Document(
                page_content=body,
                metadata={**base_meta, "section_heading": heading, "chunk_index": chunk_index},
            )
            docs.append(doc)
            chunk_index += 1

    return docs


def _parse_sections(text: str) -> list[tuple[str, str]]:
    """Parse text into (heading_text, body) tuples.

    Text before the first heading gets heading=""."""
    sections: list[tuple[str, str]] = []
    matches = list(_HEADING_RE.finditer(text))

    if not matches:
        # No headings — return entire text as single section
        return [("", text)]

    # Preamble before first heading
    if matches[0].start() > 0:
        preamble = text[: matches[0].start()]
        if preamble.strip():
            sections.append(("", preamble))

    # Each heading starts a section that runs until the next heading
    for i, match in enumerate(matches):
        heading_text = match.group(2).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]
        sections.append((heading_text, body))

    return sections


def _merge_short_sections(
    sections: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Merge sections with body < MIN_SECTION_LENGTH into the next section."""
    if not sections:
        return []

    merged: list[tuple[str, str]] = []
    pending_body = ""
    pending_heading = ""

    for heading, body in sections:
        stripped = body.strip()

        if pending_body:
            # Accumulate into pending
            combined = pending_body.rstrip() + "\n\n" + stripped
            if len(combined.strip()) < MIN_SECTION_LENGTH:
                pending_body = combined
                # Keep the first pending heading
            else:
                merged.append((pending_heading, combined))
                pending_body = ""
                pending_heading = ""
        elif len(stripped) < MIN_SECTION_LENGTH:
            # Start pending
            pending_body = stripped
            pending_heading = heading
        else:
            merged.append((heading, body))

    # Flush remaining pending
    if pending_body:
        if merged:
            # Append to last section
            last_heading, last_body = merged[-1]
            merged[-1] = (last_heading, last_body.rstrip() + "\n\n" + pending_body)
        else:
            merged.append((pending_heading, pending_body))

    return merged
