import { test, expect } from "bun:test";
import { buildSystemPrompt, extractSources, uiMessageText, SYSTEM_PROMPT } from "./rag.ts";
import type { ChunkRow } from "./store.ts";

function chunk(file_path: string, content: string): ChunkRow {
  return {
    id: 0,
    file_path,
    chunk_index: 0,
    content,
    section_heading: null,
    title: null,
    category: null,
    tags: null,
    difficulty: null,
    pack_id: null,
  };
}

test("buildSystemPrompt injects sources + context when chunks exist", () => {
  const s = buildSystemPrompt([chunk("a.md", "cats purr")]);
  expect(s).toContain(SYSTEM_PROMPT);
  expect(s).toContain("[Source: a.md]");
  expect(s).toContain("cats purr");
});

test("buildSystemPrompt states when no context found", () => {
  const s = buildSystemPrompt([]);
  expect(s).toContain("No relevant context was found");
});

test("buildSystemPrompt appends custom system prompt", () => {
  const s = buildSystemPrompt([], "Always answer in Chinese.");
  expect(s).toContain("Always answer in Chinese.");
});

test("extractSources dedupes preserving order", () => {
  const sources = extractSources([chunk("a.md", "x"), chunk("b.md", "y"), chunk("a.md", "z")]);
  expect(sources).toEqual(["a.md", "b.md"]);
});

test("uiMessageText reads v7 parts array", () => {
  expect(uiMessageText({ parts: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] })).toBe(
    "hello world",
  );
});

test("uiMessageText falls back to string content", () => {
  expect(uiMessageText({ content: "legacy" })).toBe("legacy");
});
