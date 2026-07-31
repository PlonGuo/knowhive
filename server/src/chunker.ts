// Chunking, driven by DocumentIR. Produces a two-level (parent/child) split:
//
//   section → parent window (≤ PARENT_MAX_LENGTH) → child chunks (≤ CHILD_SIZE)
//
// Only children are embedded and indexed — small chunks match a question's phrasing far
// more precisely than a whole section does. At answer time the hit is swapped for its
// parent, so the model reads the surrounding paragraph instead of the fragment that
// happened to match. That's the point of the split: retrieve small, read big.
//
// Children never straddle a parent boundary, which is what makes the swap sound.
//
// The sub-splitter is a hand-rolled recursive character splitter (equivalent in spirit to
// LangChain's RecursiveCharacterTextSplitter) — no LangChain dependency.
import {
  blocksToText,
  blockToText,
  profileDocument,
  sectionText,
  toSections,
  type Block,
  type BlockType,
  type DocumentIR,
  type DocumentProfile,
  type Section,
} from "./documentIr.ts";

/**
 * How a document gets chunked, chosen from its DocumentProfile. Most strategies map onto
 * the same section pipeline — the label exists so the decision is explicit, stored per
 * document, and RAGAS runs can compare retrieval quality per strategy bucket.
 */
export type ChunkStrategy =
  | "empty"
  | "whole-doc"
  | "sliding-window"
  | "section-as-chunk"
  | "parent-child";

export interface Chunk {
  content: string;
  section_heading: string;
  chunk_index: number;
  /** Index into ChunkedDocument.parents of the parent this child was split from. */
  parent_index: number;
}

export interface ParentChunk {
  content: string;
  section_heading: string;
  parent_index: number;
}

export interface ChunkedDocument {
  parents: ParentChunk[];
  /** The embedded, indexed units. */
  children: Chunk[];
  /** Which route this document took — stored on the documents row for per-strategy evals. */
  strategy: ChunkStrategy;
}

const MIN_SECTION_LENGTH = 100;
/** Above this, a parent is split into children rather than stored as a single chunk. */
const MAX_SECTION_LENGTH = 1500;
/** Cap on a parent's text, so expansion can't drop a whole chapter into the prompt. */
const PARENT_MAX_LENGTH = 4000;
// Child sizing is the knob that decides whether parent-child does anything at all: if
// children are as big as their sections, parent == child and expansion is a no-op. On a
// heading-dense notes corpus that is the default outcome (measured: only 4% of children
// widen at 1000/1500). Env-overridable so the retrieval-only RAGAS sweep can vary it
// the same way KNOWHIVE_RERANK_STYLE varies the reranker.
const CHILD_SIZE = envInt("KNOWHIVE_CHILD_SIZE", 1000);
const CHILD_OVERLAP = envInt("KNOWHIVE_CHILD_OVERLAP", 200);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Pick the chunking strategy for a document. Ordered short-circuit: size beats structure
 * (a tiny doc is one chunk no matter its headings). Thresholds reuse CHILD_SIZE — the
 * knob RAGAS sweeps already vary — rather than introducing new numbers to guess at.
 */
export function chooseStrategy(profile: DocumentProfile): ChunkStrategy {
  if (profile.chars === 0) return "empty";
  if (profile.chars <= CHILD_SIZE) return "whole-doc";
  if (profile.headingless) return "sliding-window";
  if (profile.medianSectionLength <= CHILD_SIZE) return "section-as-chunk";
  return "parent-child";
}

export function chunkDocument(ir: DocumentIR): ChunkedDocument {
  const strategy = chooseStrategy(profileDocument(ir));
  if (strategy === "empty") return { parents: [], children: [], strategy };

  // Whole-doc: the document is at most one child's worth of text, so slicing it up only
  // costs context. Headings stay inline — for a doc this small they ARE the content.
  if (strategy === "whole-doc") {
    const content = blocksToText(ir.blocks);
    const heading = ir.blocks.find((b) => b.type === "heading")?.text ?? "";
    return {
      parents: [{ content, section_heading: heading, parent_index: 0 }],
      children: [{ content, section_heading: heading, chunk_index: 0, parent_index: 0 }],
      strategy,
    };
  }

  // sliding-window / section-as-chunk / parent-child all run the same section pipeline:
  // a headingless doc is one "" section (so windows ARE the sliding window), and
  // chunk-sized sections come out as parent == child. The label records which shape
  // this document actually had.
  //
  // Both levels pack whole BLOCKS, not raw text: a cut only ever lands inside a block
  // when that single block exceeds the budget by itself — and then it's split on the
  // block's own terms (code on line boundaries, tables on rows with the header repeated).
  const sections = mergeShortSections(toSections(ir));

  const parents: ParentChunk[] = [];
  const children: Chunk[] = [];
  // Tying this to CHILD_SIZE rather than MAX_SECTION_LENGTH keeps children actually
  // bounded by CHILD_SIZE — otherwise a 1400-char section became one 1400-char "child".
  const childBudget = Math.min(CHILD_SIZE, MAX_SECTION_LENGTH);

  for (const section of sections) {
    const pieces = toPieces(section.blocks);

    // A long section becomes several parents; children are cut inside each one.
    for (const group of packPieces(pieces, PARENT_MAX_LENGTH)) {
      const parentIndex = parents.length;
      parents.push({
        content: joinPieces(group),
        section_heading: section.heading,
        parent_index: parentIndex,
      });

      for (const content of childContents(group, childBudget)) {
        children.push({
          content,
          section_heading: section.heading,
          chunk_index: children.length,
          parent_index: parentIndex,
        });
      }
    }
  }

  return { parents, children, strategy };
}

/** How blocks are joined inside a chunk — must match blocksToText's separator. */
const PIECE_SEP = "\n\n";

interface Piece {
  text: string;
  type: BlockType;
}

/** Render blocks to pieces sized for parent packing; only an oversized block is split. */
function toPieces(blocks: readonly Block[]): Piece[] {
  const pieces: Piece[] = [];
  for (const block of blocks) {
    const text = blockToText(block).trim();
    if (!text) continue;
    if (text.length > PARENT_MAX_LENGTH) {
      for (const frag of splitBlockText(text, block.type, PARENT_MAX_LENGTH, 0)) {
        pieces.push({ text: frag, type: block.type });
      }
    } else {
      pieces.push({ text, type: block.type });
    }
  }
  return pieces;
}

function joinPieces(pieces: readonly Piece[]): string {
  return pieces.map((p) => p.text).join(PIECE_SEP);
}

/** Greedy-pack pieces into groups whose joined text stays ≤ budget. */
function packPieces(pieces: readonly Piece[], budget: number): Piece[][] {
  const groups: Piece[][] = [];
  let current: Piece[] = [];
  let length = 0;
  for (const piece of pieces) {
    const addLen = piece.text.length + (current.length > 0 ? PIECE_SEP.length : 0);
    if (length + addLen > budget && current.length > 0) {
      groups.push(current);
      current = [];
      length = 0;
    }
    current.push(piece);
    length += piece.text.length + (current.length > 1 ? PIECE_SEP.length : 0);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Cut one parent's pieces into child contents. Pieces pack greedily; an oversized piece
 * is split on its own and each fragment stands alone, so a code or table fragment never
 * gets glued to a neighbouring block.
 */
function childContents(group: readonly Piece[], budget: number): string[] {
  const out: string[] = [];
  let buffer: Piece[] = [];
  let length = 0;
  const flush = () => {
    if (buffer.length > 0) out.push(joinPieces(buffer));
    buffer = [];
    length = 0;
  };

  for (const piece of group) {
    if (piece.text.length > budget) {
      flush();
      out.push(...splitBlockText(piece.text, piece.type, CHILD_SIZE, CHILD_OVERLAP));
      continue;
    }
    const addLen = piece.text.length + (buffer.length > 0 ? PIECE_SEP.length : 0);
    if (length + addLen > budget) flush();
    buffer.push(piece);
    length += piece.text.length + (buffer.length > 1 ? PIECE_SEP.length : 0);
  }
  flush();
  return out;
}

/**
 * Split a single block's text within `budget`, on the block's own terms: code breaks on
 * line boundaries (no overlap — duplicated code lines mislead retrieval), tables break
 * on rows with the header repeated, prose falls back to the recursive splitter.
 */
function splitBlockText(text: string, type: BlockType, budget: number, overlap: number): string[] {
  if (type === "code") return recursiveSplit(text, budget, 0, ["\n", " ", ""]);
  if (type === "table") return splitTable(text, budget);
  return recursiveSplit(text, budget, overlap);
}

/**
 * Split a row-per-line table, repeating the header (and its separator row) at the top of
 * every fragment so no fragment loses its column meaning. The repeated header means a
 * table child is not a verbatim substring of its parent — a deliberate exception to the
 * containment invariant.
 */
function splitTable(text: string, budget: number): string[] {
  const lines = text.split("\n");
  const headerLines = [lines[0]!];
  if (lines[1] !== undefined && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1])) headerLines.push(lines[1]);
  const header = headerLines.join("\n");
  const rows = lines.slice(headerLines.length);

  const out: string[] = [];
  let current: string[] = [];
  let length = header.length;
  for (const row of rows) {
    if (length + row.length + 1 > budget && current.length > 0) {
      out.push([header, ...current].join("\n"));
      current = [];
      length = header.length;
    }
    current.push(row);
    length += row.length + 1;
  }
  if (current.length > 0) out.push([header, ...current].join("\n"));
  return out;
}

/**
 * Merge sections whose body is shorter than MIN_SECTION_LENGTH into the next one, so a
 * run of stub headings doesn't become a run of near-empty chunks. The merged section
 * keeps the FIRST heading — that's the one a reader would name the passage by.
 */
function mergeShortSections(sections: readonly Section[]): Section[] {
  const merged: Section[] = [];
  let pending: Section | null = null;

  for (const section of sections) {
    if (pending) {
      const combined: Section = {
        heading: pending.heading,
        level: pending.level,
        blocks: [...pending.blocks, ...section.blocks],
      };
      if (sectionText(combined).trim().length < MIN_SECTION_LENGTH) {
        pending = combined;
      } else {
        merged.push(combined);
        pending = null;
      }
      continue;
    }
    if (sectionText(section).trim().length < MIN_SECTION_LENGTH) {
      pending = section;
    } else {
      merged.push(section);
    }
  }

  if (pending) {
    const last = merged[merged.length - 1];
    if (last) {
      last.blocks = [...last.blocks, ...pending.blocks];
    } else {
      merged.push(pending);
    }
  }
  return merged;
}

/**
 * Recursively split text into ~chunkSize pieces with `overlap` characters of overlap,
 * preferring to break on larger separators first (paragraph → line → space → char).
 */
export function recursiveSplit(
  text: string,
  chunkSize = CHILD_SIZE,
  overlap = CHILD_OVERLAP,
  separators: readonly string[] = ["\n\n", "\n", " ", ""],
): string[] {
  const sep = separators.find((s) => s === "" || text.includes(s)) ?? "";
  const rest = separators.slice(separators.indexOf(sep) + 1);
  const splits = sep === "" ? Array.from(text) : text.split(sep);

  const out: string[] = [];
  let buffer: string[] = [];
  for (const piece of splits) {
    if (piece.length < chunkSize) {
      buffer.push(piece);
    } else {
      if (buffer.length > 0) {
        out.push(...mergeSplits(buffer, sep, chunkSize, overlap));
        buffer = [];
      }
      // Oversized single piece: recurse with finer separators, or emit as-is.
      if (rest.length > 0) out.push(...recursiveSplit(piece, chunkSize, overlap, rest));
      else out.push(piece);
    }
  }
  if (buffer.length > 0) out.push(...mergeSplits(buffer, sep, chunkSize, overlap));

  return out.map((c) => c.trim()).filter((c) => c.length > 0);
}

/** Greedily pack `splits` into <=chunkSize windows joined by `sep`, keeping `overlap` chars. */
function mergeSplits(splits: string[], sep: string, chunkSize: number, overlap: number): string[] {
  const sepLen = sep.length;
  const docs: string[] = [];
  let current: string[] = [];
  let total = 0;

  for (const piece of splits) {
    const addLen = piece.length + (current.length > 0 ? sepLen : 0);
    if (total + addLen > chunkSize && current.length > 0) {
      docs.push(current.join(sep));
      // Trim from the front until under the overlap budget.
      while (total > overlap && current.length > 0) {
        total -= current[0]!.length + (current.length > 1 ? sepLen : 0);
        current.shift();
      }
    }
    current.push(piece);
    total += piece.length + (current.length > 1 ? sepLen : 0);
  }
  if (current.length > 0) docs.push(current.join(sep));
  return docs;
}
