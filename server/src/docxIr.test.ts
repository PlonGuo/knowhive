import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocx } from "./docxIr.ts";

// Fixture generated from HTML via macOS textutil (real Word-compatible styles).
const SAMPLE = readFileSync(join(import.meta.dir, "..", "test-fixtures", "sample.docx"));

test("parses headings, paragraphs, lists and tables into IR blocks", async () => {
  const ir = await parseDocx(SAMPLE);
  expect(ir.format).toBe("docx");

  const byType = Object.groupBy(ir.blocks, (b) => b.type);
  expect((byType.heading ?? []).length).toBeGreaterThanOrEqual(3);
  expect((byType.paragraph ?? []).length).toBeGreaterThanOrEqual(3);
  expect((byType.table ?? []).length).toBe(1);

  const h1 = ir.blocks.find((b) => b.type === "heading")!;
  expect(h1.text).toBe("检索系统说明");
  expect(h1.level).toBe(1);
  const h2s = ir.blocks.filter((b) => b.type === "heading" && b.level === 2);
  expect(h2s.map((b) => b.text)).toEqual(["切分策略", "参数表"]);
});

test("tables serialize as pipe markdown with a separator row (splitTable contract)", async () => {
  const ir = await parseDocx(SAMPLE);
  const table = ir.blocks.find((b) => b.type === "table")!;
  const lines = table.text.split("\n");
  expect(lines[0]).toContain("参数");
  expect(lines[0]!.startsWith("|")).toBe(true);
  expect(lines[1]).toMatch(/^\|[\s\-|]+\|$/);
  expect(lines.some((l) => l.includes("1000"))).toBe(true);
});

test("list items become a single list block with one line per item", async () => {
  const ir = await parseDocx(SAMPLE);
  const list = ir.blocks.find((b) => b.type === "list")!;
  expect(list.text).toContain("子块一千字符");
  expect(list.text).toContain("父块四千字符");
});

test("blocks are in reading order with sequential order fields", async () => {
  const ir = await parseDocx(SAMPLE);
  expect(ir.blocks.map((b) => b.order)).toEqual(ir.blocks.map((_, i) => i));
  const headingIdx = ir.blocks.findIndex((b) => b.text === "切分策略");
  const paraIdx = ir.blocks.findIndex((b) => b.text.includes("父子两级切分"));
  expect(headingIdx).toBeLessThan(paraIdx);
});
