import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDbAt } from "./db.ts";
import { getCachedSummary, getOrGenerate, storeSummary } from "./summary.ts";

// Parity tests against backend/app/services/summary_service.py (cache + get_or_generate).

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "knowhive-summary-"));
  const db = openDbAt(":memory:");
  const generated: string[] = [];
  const generate = async (content: string, filePath: string) => {
    generated.push(filePath);
    return `summary of ${filePath} (${content.length} chars)`;
  };
  return { dir, db, generated, generate };
}

test("storeSummary caches and getCachedSummary reads back", () => {
  const { db } = setup();
  expect(getCachedSummary(db, "a.md")).toBeNull();
  storeSummary(db, "a.md", "first");
  expect(getCachedSummary(db, "a.md")).toBe("first");
  storeSummary(db, "a.md", "second");
  expect(getCachedSummary(db, "a.md")).toBe("second");
});

test("getOrGenerate returns the cached summary without calling the LLM", async () => {
  const { dir, db, generated, generate } = setup();
  storeSummary(db, "a.md", "cached!");
  const summary = await getOrGenerate(db, "a.md", dir, generate);
  expect(summary).toBe("cached!");
  expect(generated).toEqual([]);
});

test("getOrGenerate generates, caches and returns for an existing file", async () => {
  const { dir, db, generated, generate } = setup();
  writeFileSync(join(dir, "b.md"), "# B\ncontent");
  const summary = await getOrGenerate(db, "b.md", dir, generate);
  expect(summary).toBe("summary of b.md (11 chars)");
  expect(generated).toEqual(["b.md"]);
  expect(getCachedSummary(db, "b.md")).toBe(summary);
});

test("getOrGenerate returns null for a missing file", async () => {
  const { dir, db, generate } = setup();
  expect(await getOrGenerate(db, "ghost.md", dir, generate)).toBeNull();
});
