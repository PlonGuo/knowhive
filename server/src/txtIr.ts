// Plain text → DocumentIR: paragraphs split on blank lines, nothing else.
//
// Deliberately structure-blind (v1): a headingless IR routes to the
// sliding-window chunk strategy, which is exactly right for novels, notes
// dumps and logs. Pseudo-structured text (RFCs with numbered sections and
// indent-based layout) would need real heuristics — measure first, then decide.
import type { Block, DocumentIR } from "./documentIr.ts";

export function parseTxt(source: string): DocumentIR {
  const blocks: Block[] = [];
  for (const piece of source.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const text = piece.trim();
    if (!text) continue;
    blocks.push({ type: "paragraph", text, order: blocks.length });
  }
  return { format: "txt", blocks };
}
