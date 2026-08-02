import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocx, parseDocxHtml } from "./docxIr.ts";

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

// --- real-world regressions (2026-08-02, eval-corpus/docx/) -------------------
// Eight real documents (government, thesis, journal templates) exposed three
// defects that the hand-built python-docx fixture could not: custom heading
// style names, table-of-contents lines, and nested tables.

describe("nested tables", () => {
  test("inner table rows do not get hoisted into the outer table", async () => {
    // node-html-parser's querySelectorAll("tr") is a DESCENDANT query, so an inner
    // table's rows were being appended to the outer table's row list — real corpus
    // produced a 103-row / 32-column monster out of a small form.
    const html = `<table>
      <tr><td>Outer A</td><td>Outer B</td></tr>
      <tr><td><table><tr><td>i1</td><td>i2</td><td>i3</td><td>i4</td></tr></table></td><td>x</td></tr>
    </table>`;
    const ir = await parseDocxHtml(html);
    const tables = ir.blocks.filter((b) => b.type === "table");
    expect(tables).toHaveLength(1);
    const lines = tables[0]!.text.split("\n");
    // header + separator + 1 data row; every line the same width as the header.
    expect(lines).toHaveLength(3);
    const widths = new Set(lines.map((l) => l.split("|").length));
    expect(widths.size).toBe(1);
    // The inner cells' text is kept (it is real content) but must stay INSIDE one
    // cell and stay readable — not concatenated into "i1i2i3i4".
    expect(tables[0]!.text).toContain("i1 i2 i3 i4");
  });
});

describe("table of contents", () => {
  test("auto-generated TOC entries are dropped, not ingested as prose", async () => {
    // Word TOC fields flatten to paragraphs like "一、部门主要职责\t2", which
    // duplicate every real heading verbatim and pollute retrieval.
    const html = [
      "<p>目录</p>",
      "<p>第一部分 部门概况\t1</p>",
      "<p>一、部门主要职责\t2</p>",
      "<p>二、部门预算单位构成\t3</p>",
      "<p>三、其他事项........... 12</p>",
      "<h1>第一部分 部门概况</h1>",
      "<p>本部门负责……</p>",
    ].join("");
    const ir = await parseDocxHtml(html);
    const texts = ir.blocks.map((b) => b.text);
    expect(texts.some((t) => t.includes("\t"))).toBe(false);
    expect(texts.some((t) => /\.{4,}/.test(t))).toBe(false);
    expect(texts).toContain("本部门负责……");
    expect(ir.blocks.filter((b) => b.type === "heading")).toHaveLength(1);
  });

  test("a lone numbered line that is not part of a TOC run survives", async () => {
    const ir = await parseDocxHtml("<p>指标值\t42</p><p>正文段落。</p>");
    expect(ir.blocks.map((b) => b.text)).toContain("指标值\t42");
  });
});

describe("custom heading style names", () => {
  test("Chinese chapter numbering is promoted when Word styles produced no headings", async () => {
    // Theses/government docs use custom style names (phd_chapter, 一级条标题);
    // mammoth maps by style NAME so those emit <p> and the whole document
    // flattens to sliding-window. Promote only when there are zero real headings,
    // so documents whose styles DID work are never second-guessed.
    const html = [
      "<p>第一章 绪论</p>",
      "<p>研究背景……</p>",
      "<p>一、问题定义</p>",
      "<p>（一）子问题</p>",
      "<p>正文。</p>",
    ].join("");
    const ir = await parseDocxHtml(html);
    const heads = ir.blocks.filter((b) => b.type === "heading");
    expect(heads.map((h) => [h.text, h.level])).toEqual([
      ["第一章 绪论", 1],
      ["一、问题定义", 2],
      ["（一）子问题", 3],
    ]);
  });

  test("promotion is skipped when the document already has real headings", async () => {
    const html = "<h1>Real Heading</h1><p>一、这是正文里的枚举项</p>";
    const ir = await parseDocxHtml(html);
    expect(ir.blocks.filter((b) => b.type === "heading")).toHaveLength(1);
    expect(ir.blocks[1]!.type).toBe("paragraph");
  });

  test("a long paragraph that merely starts with numbering is not a heading", async () => {
    const html = "<p>一、" + "这是一段很长的正文内容，".repeat(6) + "</p>";
    const ir = await parseDocxHtml(html);
    expect(ir.blocks.filter((b) => b.type === "heading")).toHaveLength(0);
  });
});
