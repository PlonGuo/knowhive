// Parse YAML frontmatter from Markdown. Ported from
// backend/app/services/frontmatter_parser.py (same regex + tag-normalization behavior).
import { parse as parseYaml } from "yaml";

export interface FrontmatterData {
  title: string | null;
  category: string | null;
  tags: string[];
  difficulty: string | null;
  pack_id: string | null;
}

function empty(): FrontmatterData {
  return { title: null, category: null, tags: [], difficulty: null, pack_id: null };
}

// Python used \A...---\n(.*?)---\n?  with DOTALL. In JS: anchor at string start (no `m`
// flag), [\s\S] for dotall. Matches a leading `--- ... ---` block.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)---[ \t]*\r?\n?/;

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

export function parseFrontmatter(text: string): { data: FrontmatterData; body: string } {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { data: empty(), body: text };

  const yamlBlock = match[1]!;
  const body = text.slice(match[0].length);

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBlock);
  } catch {
    return { data: empty(), body };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { data: empty(), body };
  }

  const obj = parsed as Record<string, unknown>;
  const tagsRaw = obj.tags;
  let tags: string[] = [];
  if (typeof tagsRaw === "string") tags = [tagsRaw];
  else if (Array.isArray(tagsRaw)) tags = tagsRaw.map((t) => String(t));

  return {
    data: {
      title: strOrNull(obj.title),
      category: strOrNull(obj.category),
      tags,
      difficulty: strOrNull(obj.difficulty),
      pack_id: strOrNull(obj.pack_id),
    },
    body,
  };
}
