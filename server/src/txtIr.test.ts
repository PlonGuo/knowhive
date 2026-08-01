import { test, expect } from "bun:test";
import { parseTxt } from "./txtIr.ts";

test("empty or whitespace text yields no blocks", () => {
  expect(parseTxt("").blocks).toEqual([]);
  expect(parseTxt("  \n\n \t ").blocks).toEqual([]);
});

test("blank lines split paragraphs; hard-wrapped lines stay in one paragraph", () => {
  const ir = parseTxt("first paragraph line one\nline two of the same paragraph\n\nsecond paragraph\n");
  expect(ir.format).toBe("txt");
  expect(ir.blocks).toHaveLength(2);
  expect(ir.blocks[0]).toMatchObject({
    type: "paragraph",
    order: 0,
    text: "first paragraph line one\nline two of the same paragraph",
  });
  expect(ir.blocks[1]).toMatchObject({ type: "paragraph", order: 1, text: "second paragraph" });
});

test("multiple consecutive blank lines and CRLF are tolerated", () => {
  const ir = parseTxt("a\r\n\r\n\r\n\r\nb\r\n");
  expect(ir.blocks.map((b) => b.text)).toEqual(["a", "b"]);
});

test("a plain novel chapter routes headingless (no heading blocks ever)", () => {
  const ir = parseTxt("Chapter I.\n\nIt is a truth universally acknowledged...\n\nHowever little known...");
  expect(ir.blocks.every((b) => b.type === "paragraph")).toBe(true);
});
