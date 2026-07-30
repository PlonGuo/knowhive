// DocumentIR — the single intermediate representation every input format is parsed into.
//
// Why: before this, chunking re-parsed Markdown with a regex (chunker.ts) and there was
// no path for PDF/docx at all. With an IR, each format owns one producer (markdownIr.ts,
// later pdfIr/docxIr/txtIr) and chunking has exactly one implementation that consumes
// blocks — so adding a format never touches the chunker, and the heading tree the chunker
// needs for parent-child comes from a real parser instead of `/^#{1,6}/gm`.
//
// Blocks are flat and in reading order. Structure is expressed by `type`/`level`, not by
// nesting, because PDF producers recover a linear reading order rather than a tree.

export type BlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "code"
  | "quote";

export interface Block {
  type: BlockType;
  /** Plain text. For `code` this is the raw source; for `table`, a row-per-line rendering. */
  text: string;
  /** Heading depth 1-6. Only set on `heading`. */
  level?: number;
  /** Fenced-code language when the source declared one. */
  lang?: string;
  /** 0-based position in reading order. */
  order: number;
  /** PDF only: 1-based page number. */
  page?: number;
  /** PDF only: [x0, y0, x1, y1] in the producer's coordinate space. */
  bbox?: [number, number, number, number];
}

export type DocumentFormat = "md" | "pdf" | "docx" | "txt";

export interface DocumentIR {
  format: DocumentFormat;
  blocks: Block[];
}

/**
 * A heading and everything under it, up to the next heading of the same or higher rank.
 * This is what becomes a parent chunk.
 */
export interface Section {
  /** Heading text; "" for content before the first heading. */
  heading: string;
  /** Heading depth; 0 for the pre-heading preamble. */
  level: number;
  /** Blocks belonging to this section, excluding the heading block itself. */
  blocks: Block[];
}

/** Render a block back to the text that gets embedded / shown to the model. */
export function blockToText(block: Block): string {
  if (block.type === "heading") {
    return `${"#".repeat(block.level ?? 1)} ${block.text}`;
  }
  return block.text;
}

/** Join blocks with blank lines, dropping empties. */
export function blocksToText(blocks: readonly Block[]): string {
  return blocks
    .map(blockToText)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join("\n\n");
}

/**
 * Group blocks into heading-delimited sections, in document order.
 *
 * A section runs from a heading to the next heading of ANY level — i.e. sections are
 * flat, not nested. Nesting would make parent chunks contain their own sub-parents and
 * blow up the stored text; the heading path is preserved on each section instead.
 */
export function toSections(ir: DocumentIR): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const block of ir.blocks) {
    if (block.type === "heading") {
      current = { heading: block.text, level: block.level ?? 1, blocks: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { heading: "", level: 0, blocks: [] };
      sections.push(current);
    }
    current.blocks.push(block);
  }

  // Body-less headings are kept: they are real structure, and the chunker's short-section
  // merge folds them into the following section (which is what names the passage).
  return sections;
}

/** The text of a section: its own blocks. The heading is carried as metadata, not body. */
export function sectionText(section: Section): string {
  return blocksToText(section.blocks);
}

/**
 * Cheap shape summary of a parsed document — the same "probe first, then decide" move the
 * PDF path uses, except the IR already holds every signal so it costs one pass over blocks
 * instead of a second parse.
 *
 * This is a measurement, not a policy: nothing routes on it yet. Thresholds have to come
 * out of the retrieval-only RAGAS sweep, not from guessing which shape "wants" which
 * strategy. Until then it's a corpus diagnostic (see docs/Corpus-Sources.md).
 */
export interface DocumentProfile {
  format: DocumentFormat;
  chars: number;
  blocks: number;
  sections: number;
  /** Headings per 1000 chars. High = already chunk-sized prose; 0 = no structure at all. */
  headingDensity: number;
  medianSectionLength: number;
  maxSectionLength: number;
  /** Share of characters sitting inside fenced/indented code blocks. */
  codeRatio: number;
  tableRatio: number;
  /** True when the document has no headings to cut on — a sliding window is the only option. */
  headingless: boolean;
}

export function profileDocument(ir: DocumentIR): DocumentProfile {
  const sections = toSections(ir);
  const lengths = sections.map((s) => sectionText(s).length).sort((a, b) => a - b);
  const chars = ir.blocks.reduce((n, b) => n + b.text.length, 0);
  const charsOfType = (type: BlockType) =>
    ir.blocks.filter((b) => b.type === type).reduce((n, b) => n + b.text.length, 0);
  const headings = ir.blocks.filter((b) => b.type === "heading").length;

  return {
    format: ir.format,
    chars,
    blocks: ir.blocks.length,
    sections: sections.length,
    headingDensity: chars === 0 ? 0 : (headings / chars) * 1000,
    medianSectionLength: median(lengths),
    maxSectionLength: lengths.length === 0 ? 0 : lengths[lengths.length - 1]!,
    codeRatio: chars === 0 ? 0 : charsOfType("code") / chars,
    tableRatio: chars === 0 ? 0 : charsOfType("table") / chars,
    headingless: headings === 0,
  };
}

/** Median of an already-sorted list; averages the middle pair on even counts. */
function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
