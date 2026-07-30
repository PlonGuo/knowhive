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
import { sectionText, toSections, type DocumentIR, type Section } from "./documentIr.ts";

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

export function chunkDocument(ir: DocumentIR): ChunkedDocument {
  const sections = mergeShortSections(toSections(ir));

  const parents: ParentChunk[] = [];
  const children: Chunk[] = [];

  for (const section of sections) {
    const body = sectionText(section).trim();
    if (!body) continue;

    // A long section becomes several parents; children are cut inside each one.
    const windows =
      body.length > PARENT_MAX_LENGTH
        ? recursiveSplit(body, PARENT_MAX_LENGTH, 0)
        : [body];

    for (const window of windows) {
      const parentIndex = parents.length;
      parents.push({
        content: window,
        section_heading: section.heading,
        parent_index: parentIndex,
      });

      // Split whenever the window exceeds the child budget. Tying this to CHILD_SIZE
      // rather than MAX_SECTION_LENGTH keeps children actually bounded by CHILD_SIZE —
      // otherwise a 1400-char section became one 1400-char "child".
      const splitAbove = Math.min(CHILD_SIZE, MAX_SECTION_LENGTH);
      const pieces =
        window.length > splitAbove ? recursiveSplit(window, CHILD_SIZE, CHILD_OVERLAP) : [window];

      for (const piece of pieces) {
        children.push({
          content: piece,
          section_heading: section.heading,
          chunk_index: children.length,
          parent_index: parentIndex,
        });
      }
    }
  }

  return { parents, children };
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
