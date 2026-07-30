// Markdown → DocumentIR, via a real CommonMark+GFM parser (mdast).
//
// Replaces the `/^(#{1,6})\s+(.+)$/gm` scan the chunker used to do. That regex matched
// any line starting with `#` — including comment lines inside fenced code blocks, which
// in a technical knowledge base means Python/shell snippets were silently splitting
// documents at fake headings. A parser knows what a fence is; a line regex cannot.
//
// Block text is sliced from the original source by node offsets rather than reconstructed
// from the AST, so links, emphasis, inline code and table pipes survive verbatim into the
// embedded text and the model's context.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import type { Block, BlockType, DocumentIR } from "./documentIr.ts";

/** mdast node types that become IR blocks, and what they map to. */
const BLOCK_TYPES: Record<string, BlockType> = {
  heading: "heading",
  paragraph: "paragraph",
  code: "code",
  list: "list",
  table: "table",
  blockquote: "quote",
};

interface MdNode {
  type: string;
  depth?: number;
  lang?: string | null;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

export function parseMarkdown(source: string): DocumentIR {
  if (!source.trim()) return { format: "md", blocks: [] };

  const tree = fromMarkdown(source, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  }) as unknown as MdNode;

  const blocks: Block[] = [];
  for (const node of tree.children ?? []) {
    const type = BLOCK_TYPES[node.type];
    if (!type) continue; // thematicBreak, html, definition — no retrievable text.

    // Headings carry their text without the leading `#`s; blockToText re-adds them.
    const text = type === "heading" ? inlineText(node) : sliceSource(source, node);
    if (!text.trim()) continue;

    const block: Block = { type, text, order: blocks.length };
    if (type === "heading") block.level = clampDepth(node.depth);
    if (type === "code" && node.lang) block.lang = node.lang;
    blocks.push(block);
  }

  return { format: "md", blocks };
}

/** Original source text for a node, falling back to its literal value. */
function sliceSource(source: string, node: MdNode): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return node.value ?? "";
  return source.slice(start, end);
}

/** Concatenated text of a node's inline descendants (heading text, table cell text, …). */
function inlineText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(inlineText).join("");
}

function clampDepth(depth: number | undefined): number {
  if (!depth || depth < 1) return 1;
  return depth > 6 ? 6 : depth;
}
