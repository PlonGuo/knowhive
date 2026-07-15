import { describe, expect, test } from "bun:test";
import {
  AGENT_SEARCH_K,
  LIST_NOTES_MAX,
  READ_NOTE_MAX_CHARS,
  SourceCollector,
  buildAgentTools,
  type AgentToolDeps,
} from "./agentTools.ts";
import { SafePathError } from "./knowledge.ts";
import type { ChunkRow } from "./store.ts";

function chunk(overrides: Partial<ChunkRow>): ChunkRow {
  return {
    id: 1,
    file_path: "notes/a.md",
    chunk_index: 0,
    content: "content",
    section_heading: null,
    title: null,
    category: null,
    tags: null,
    difficulty: null,
    pack_id: null,
    ...overrides,
  } as ChunkRow;
}

function makeDeps(overrides: Partial<AgentToolDeps> = {}): AgentToolDeps {
  return {
    retrieve: async () => [],
    readNote: () => ({ path: "notes/a.md", content: "hello" }),
    listNotePaths: () => [],
    sources: new SourceCollector(),
    ...overrides,
  };
}

// Tool execute options — the tools under test don't consume them.
const opts = { toolCallId: "t1", messages: [] } as never;

describe("SourceCollector", () => {
  test("dedupes and preserves insertion order", () => {
    const c = new SourceCollector();
    c.add("b.md", "a.md");
    c.add("a.md", "c.md");
    expect(c.list()).toEqual(["b.md", "a.md", "c.md"]);
  });

  test("list returns a copy, not internal state", () => {
    const c = new SourceCollector();
    c.add("a.md");
    const snapshot = c.list();
    snapshot.push("evil.md");
    expect(c.list()).toEqual(["a.md"]);
  });
});

describe("search_knowledge", () => {
  test("retrieves with fixed k, returns compact results, collects sources", async () => {
    const seen: Array<{ query: string; k: number }> = [];
    const sources = new SourceCollector();
    const tools = buildAgentTools(
      makeDeps({
        retrieve: async (query, k) => {
          seen.push({ query, k });
          return [
            chunk({ file_path: "notes/dp.md", section_heading: "状态设计", content: "dp[i][j]" }),
            chunk({ file_path: "notes/digit.md", content: "数位" }),
          ];
        },
        sources,
      }),
    );
    const out = await tools.search_knowledge!.execute!({ query: "区间DP" }, opts);
    expect(seen).toEqual([{ query: "区间DP", k: AGENT_SEARCH_K }]);
    expect(out).toEqual({
      results: [
        { file_path: "notes/dp.md", section: "状态设计", content: "dp[i][j]" },
        { file_path: "notes/digit.md", section: null, content: "数位" },
      ],
    });
    expect(sources.list()).toEqual(["notes/dp.md", "notes/digit.md"]);
  });

  test("retrieve failure returns {error}, does not throw", async () => {
    const tools = buildAgentTools(
      makeDeps({
        retrieve: async () => {
          throw new Error("ollama down");
        },
      }),
    );
    const out = (await tools.search_knowledge!.execute!({ query: "x" }, opts)) as { error: string };
    expect(out.error).toContain("ollama down");
  });
});

describe("read_note", () => {
  test("returns content and collects the source", async () => {
    const sources = new SourceCollector();
    const tools = buildAgentTools(
      makeDeps({ readNote: () => ({ path: "notes/a.md", content: "# A" }), sources }),
    );
    const out = await tools.read_note!.execute!({ path: "notes/a.md" }, opts);
    expect(out).toEqual({ path: "notes/a.md", content: "# A" });
    expect(sources.list()).toEqual(["notes/a.md"]);
  });

  test("truncates long content with a marker", async () => {
    const long = "x".repeat(READ_NOTE_MAX_CHARS + 500);
    const tools = buildAgentTools(makeDeps({ readNote: () => ({ path: "a.md", content: long }) }));
    const out = (await tools.read_note!.execute!({ path: "a.md" }, opts)) as { content: string };
    expect(out.content.length).toBeLessThan(long.length);
    expect(out.content).toContain("[truncated]");
    expect(out.content.slice(0, READ_NOTE_MAX_CHARS)).toBe(long.slice(0, READ_NOTE_MAX_CHARS));
  });

  test("errors become {error} values, not throws, and collect no source", async () => {
    const sources = new SourceCollector();
    const tools = buildAgentTools(
      makeDeps({
        readNote: () => {
          throw new SafePathError("Path traversal is not allowed");
        },
        sources,
      }),
    );
    const out = (await tools.read_note!.execute!({ path: "../etc" }, opts)) as { error: string };
    expect(out.error).toContain("traversal");
    expect(sources.list()).toEqual([]);
  });
});

describe("list_notes", () => {
  test("returns flattened paths", async () => {
    const tools = buildAgentTools(
      makeDeps({ listNotePaths: () => ["a.md", "dir/b.md"] }),
    );
    expect(await tools.list_notes!.execute!({}, opts)).toEqual({ paths: ["a.md", "dir/b.md"] });
  });

  test("caps the listing at LIST_NOTES_MAX with a marker", async () => {
    const many = Array.from({ length: LIST_NOTES_MAX + 50 }, (_, i) => `n${i}.md`);
    const tools = buildAgentTools(makeDeps({ listNotePaths: () => many }));
    const out = (await tools.list_notes!.execute!({}, opts)) as { paths: string[]; truncated?: boolean };
    expect(out.paths.length).toBe(LIST_NOTES_MAX);
    expect(out.truncated).toBe(true);
  });
});

describe("search_history (M3)", () => {
  test("absent without a searchHistory dep, present with one", () => {
    expect(buildAgentTools(makeDeps()).search_history).toBeUndefined();
    const tools = buildAgentTools(
      makeDeps({ searchHistory: () => [{ question: "q", answer: "a", when: "2026-07-16" }] }),
    );
    expect(tools.search_history).toBeDefined();
  });

  test("returns episodic hits", async () => {
    const tools = buildAgentTools(
      makeDeps({ searchHistory: (q) => [{ question: `问过${q}`, answer: "a", when: "t" }] }),
    );
    const out = await tools.search_history!.execute!({ query: "堆" }, opts);
    expect(out).toEqual({ results: [{ question: "问过堆", answer: "a", when: "t" }] });
  });
});
