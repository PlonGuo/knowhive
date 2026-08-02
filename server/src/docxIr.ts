// docx → DocumentIR, via mammoth (docx → semantic HTML) + a light HTML walk.
//
// docx carries real structure — Heading1-6 styles, lists, tables — so unlike
// PDF there is no layout inference and no plugin: mammoth is pure JS, the app
// stays single-runtime. Tables serialize as pipe markdown with a separator row
// because the chunker's splitTable() keys on "line 1 = header, line 2 = |---|"
// to repeat headers when splitting oversized tables.
//
// The three post-passes below all come from a 2026-08-02 regression over eight
// real documents (eval-corpus/docx/): government notices, a thesis template and
// journal templates. The hand-built python-docx fixture had clean Word styles and
// hid every one of these.
import mammoth from "mammoth";
import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import type { Block, DocumentIR } from "./documentIr.ts";

export async function parseDocx(bytes: Uint8Array): Promise<DocumentIR> {
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return parseDocxHtml(html);
}

/** The HTML→IR half, exported so the structural rules are testable without a .docx. */
export function parseDocxHtml(html: string): DocumentIR {
  const root = parseHtml(html);
  const raw: Omit<Block, "order">[] = [];

  const push = (block: Omit<Block, "order">) => {
    if (!block.text.trim()) return;
    raw.push({ ...block, text: block.text.trim() });
  };

  for (const node of root.childNodes) {
    const el = node as HTMLElement;
    if (!el.tagName) {
      // Stray top-level text (rare from mammoth) — keep it as a paragraph.
      push({ type: "paragraph", text: node.text });
      continue;
    }
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      push({ type: "heading", text: el.text, level: parseInt(tag[1]!, 10) });
    } else if (tag === "table") {
      push({ type: "table", text: tableToPipes(el) });
    } else if (tag === "ul" || tag === "ol") {
      const items = el.querySelectorAll("li").map((li) => `- ${li.text.trim()}`);
      push({ type: "list", text: items.join("\n") });
    } else if (tag === "pre") {
      push({ type: "code", text: el.text });
    } else if (tag === "blockquote") {
      push({ type: "quote", text: el.text });
    } else {
      // p and anything else prose-like.
      push({ type: "paragraph", text: el.text });
    }
  }

  const blocks = promoteNumberedHeadings(dropTableOfContents(raw)).map((b, order) => ({
    ...b,
    order,
  }));
  return { format: "docx", blocks };
}

// --- table of contents -------------------------------------------------------

/** A Word TOC field flattens to "一、部门主要职责\t2" or "标题........ 12". */
const TOC_LINE = /(?:\t\s*|\.{4,}\s*)\d+\s*$/;
/** Below this, a numbered line is far more likely to be real content than a TOC. */
const MIN_TOC_RUN = 3;

/**
 * Drop runs of TOC entries. They duplicate every real heading verbatim, so they
 * both waste chunk budget and give retrieval a near-duplicate of the true answer
 * with none of the content. A run threshold keeps a lone "指标值\t42" — a real
 * data line — out of the blast radius.
 */
function dropTableOfContents(blocks: Omit<Block, "order">[]): Omit<Block, "order">[] {
  const drop = new Set<number>();
  let runStart = -1;
  const closeRun = (end: number) => {
    if (runStart >= 0 && end - runStart >= MIN_TOC_RUN) {
      for (let i = runStart; i < end; i++) drop.add(i);
    }
    runStart = -1;
  };
  blocks.forEach((b, i) => {
    if (b.type === "paragraph" && TOC_LINE.test(b.text)) {
      if (runStart < 0) runStart = i;
    } else {
      closeRun(i);
    }
  });
  closeRun(blocks.length);
  return blocks.filter((_, i) => !drop.has(i));
}

// --- custom heading style names ----------------------------------------------

/** Chinese official numbering, most significant first. */
const NUMBERING: { re: RegExp; level: number }[] = [
  { re: /^第[一二三四五六七八九十百零〇\d]+[章部篇节]/, level: 1 },
  { re: /^[一二三四五六七八九十百]+[、.．]/, level: 2 },
  { re: /^[（(][一二三四五六七八九十百]+[）)]/, level: 3 },
];
/** Headings are short. Past this, a numbered line is a numbered paragraph. */
const MAX_PROMOTED_HEADING_CHARS = 40;

/**
 * Promote numbered paragraphs to headings — but ONLY for documents where Word
 * produced no headings at all.
 *
 * mammoth maps styles by their w:name, so a thesis using `phd_chapter` or a
 * notice using `一级条标题` emits plain <p> and the entire document flattens to
 * one headingless blob (measured: 0 headings across 222 blocks, which routes the
 * whole thesis to sliding-window instead of parent-child). The zero-heading gate
 * is what makes this safe: a document whose styles DID work is never
 * second-guessed, so an enumerated list inside prose stays prose.
 */
function promoteNumberedHeadings(blocks: Omit<Block, "order">[]): Omit<Block, "order">[] {
  if (blocks.some((b) => b.type === "heading")) return blocks;
  return blocks.map((b) => {
    if (b.type !== "paragraph" || b.text.length > MAX_PROMOTED_HEADING_CHARS) return b;
    const hit = NUMBERING.find((n) => n.re.test(b.text));
    return hit ? { ...b, type: "heading" as const, level: hit.level } : b;
  });
}

// --- tables ------------------------------------------------------------------

/** Nearest enclosing element with one of the given tags (self excluded). */
function closestTag(el: HTMLElement, tags: string[]): HTMLElement | null {
  let cur = el.parentNode as HTMLElement | null;
  while (cur) {
    if (cur.tagName && tags.includes(cur.tagName.toLowerCase())) return cur;
    cur = cur.parentNode as HTMLElement | null;
  }
  return null;
}

/**
 * Text of one cell. A cell holding a nested table would otherwise come back as its
 * descendants' text run together ("i1i2i3i4"), so nested cells are joined with a
 * space: the content survives, it just stops pretending to be structure.
 */
function cellText(cell: HTMLElement): string {
  const inner = cell.querySelectorAll("td,th");
  const text = inner.length > 0 ? inner.map((c) => c.text.trim()).join(" ") : cell.text;
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Render an HTML table as pipe markdown: header row, separator, data rows.
 *
 * Row and cell lookups are scoped to THIS table: querySelectorAll is a descendant
 * query, so a nested table used for form layout dumped its rows into the outer
 * table's list — a real application form produced a single 103-row x 32-column
 * block, where most cells were padding.
 */
function tableToPipes(table: HTMLElement): string {
  const ownRows = table.querySelectorAll("tr").filter((tr) => closestTag(tr, ["table"]) === table);
  const rows = ownRows.map((tr) =>
    tr
      .querySelectorAll("th,td")
      .filter((cell) => closestTag(cell, ["tr"]) === tr)
      .map((cell) => cellText(cell).replace(/\|/g, "\\|")),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  const [header, ...data] = rows;
  return [line(header!), `|${Array(width).fill(" --- ").join("|")}|`, ...data.map(line)].join("\n");
}
