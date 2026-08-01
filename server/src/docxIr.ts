// docx → DocumentIR, via mammoth (docx → semantic HTML) + a light HTML walk.
//
// docx carries real structure — Heading1-6 styles, lists, tables — so unlike
// PDF there is no layout inference and no plugin: mammoth is pure JS, the app
// stays single-runtime. Tables serialize as pipe markdown with a separator row
// because the chunker's splitTable() keys on "line 1 = header, line 2 = |---|"
// to repeat headers when splitting oversized tables.
import mammoth from "mammoth";
import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import type { Block, DocumentIR } from "./documentIr.ts";

export async function parseDocx(bytes: Uint8Array): Promise<DocumentIR> {
  const { value: html } = await mammoth.convertToHtml({
    buffer: Buffer.from(bytes),
  });

  const root = parseHtml(html);
  const blocks: Block[] = [];

  const push = (block: Omit<Block, "order">) => {
    if (!block.text.trim()) return;
    blocks.push({ ...block, text: block.text.trim(), order: blocks.length });
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

  return { format: "docx", blocks };
}

/** Render an HTML table as pipe markdown: header row, separator, data rows. */
function tableToPipes(table: HTMLElement): string {
  const rows = table.querySelectorAll("tr").map((tr) =>
    tr.querySelectorAll("th,td").map((cell) => cell.text.trim().replace(/\|/g, "\\|")),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  const [header, ...data] = rows;
  return [line(header!), `|${Array(width).fill(" --- ").join("|")}|`, ...data.map(line)].join("\n");
}
