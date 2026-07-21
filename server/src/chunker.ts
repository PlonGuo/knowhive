// Heading-aware Markdown chunker. Ported from backend/app/services/heading_chunker.py:
// split by headings, merge short sections, sub-split long ones. The sub-splitter is a
// hand-rolled recursive character splitter (equivalent in spirit to LangChain's
// RecursiveCharacterTextSplitter) — no LangChain dependency.

export interface Chunk {
  content: string;
  section_heading: string;
  chunk_index: number;
}

const MIN_SECTION_LENGTH = 100;
const MAX_SECTION_LENGTH = 1500;

export function splitByHeadings(text: string): Chunk[] {
  if (!text || !text.trim()) return [];

  const sections = mergeShortSections(parseSections(text));

  const chunks: Chunk[] = [];
  let index = 0;
  for (const [heading, rawBody] of sections) {
    const body = rawBody.trim();
    if (!body) continue;
    if (body.length > MAX_SECTION_LENGTH) {
      for (const piece of recursiveSplit(body, 1000, 200)) {
        chunks.push({ content: piece, section_heading: heading, chunk_index: index++ });
      }
    } else {
      chunks.push({ content: body, section_heading: heading, chunk_index: index++ });
    }
  }
  return chunks;
}

/** Parse into [heading, body] pairs. Text before the first heading gets heading "". */
function parseSections(text: string): [string, string][] {
  const re = /^(#{1,6})\s+(.+)$/gm;
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return [["", text]];

  const sections: [string, string][] = [];
  const firstStart = matches[0]!.index!;
  if (firstStart > 0) {
    const preamble = text.slice(0, firstStart);
    if (preamble.trim()) sections.push(["", preamble]);
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const heading = m[2]!.trim();
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    sections.push([heading, text.slice(start, end)]);
  }
  return sections;
}

/** Merge sections whose trimmed body is shorter than MIN_SECTION_LENGTH into the next. */
function mergeShortSections(sections: [string, string][]): [string, string][] {
  if (sections.length === 0) return [];
  const merged: [string, string][] = [];
  let pendingBody = "";
  let pendingHeading = "";

  for (const [heading, body] of sections) {
    const stripped = body.trim();
    if (pendingBody) {
      const combined = pendingBody.replace(/\s+$/, "") + "\n\n" + stripped;
      if (combined.trim().length < MIN_SECTION_LENGTH) {
        pendingBody = combined;
      } else {
        merged.push([pendingHeading, combined]);
        pendingBody = "";
        pendingHeading = "";
      }
    } else if (stripped.length < MIN_SECTION_LENGTH) {
      pendingBody = stripped;
      pendingHeading = heading;
    } else {
      merged.push([heading, body]);
    }
  }

  if (pendingBody) {
    if (merged.length > 0) {
      const [lh, lb] = merged[merged.length - 1]!;
      merged[merged.length - 1] = [lh, lb.replace(/\s+$/, "") + "\n\n" + pendingBody];
    } else {
      merged.push([pendingHeading, pendingBody]);
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
  chunkSize = 1000,
  overlap = 200,
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
