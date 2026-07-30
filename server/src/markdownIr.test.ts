import { test, expect } from "bun:test";
import { parseMarkdown } from "./markdownIr.ts";
import { toSections } from "./documentIr.ts";

test("empty input yields no blocks", () => {
  expect(parseMarkdown("").blocks).toEqual([]);
  expect(parseMarkdown("   \n\n ").blocks).toEqual([]);
});

test("headings carry level and text without the hashes", () => {
  const { blocks } = parseMarkdown("# One\n\ntext\n\n### Three\n\nmore");
  const headings = blocks.filter((b) => b.type === "heading");
  expect(headings.map((h) => [h.text, h.level])).toEqual([
    ["One", 1],
    ["Three", 3],
  ]);
});

test("block types are recognised", () => {
  const md = [
    "# H",
    "a paragraph",
    "- item one\n- item two",
    "> quoted",
    "```js\nconst x = 1;\n```",
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
  ].join("\n\n");
  const types = parseMarkdown(md).blocks.map((b) => b.type);
  expect(types).toEqual(["heading", "paragraph", "list", "quote", "code", "table"]);
});

test("fenced code keeps its language and its source", () => {
  const { blocks } = parseMarkdown("```python\nprint(1)\n```");
  const code = blocks.find((b) => b.type === "code")!;
  expect(code.lang).toBe("python");
  expect(code.text).toContain("print(1)");
});

test("inline markdown survives verbatim into block text", () => {
  const { blocks } = parseMarkdown("See [the docs](https://example.com) for `flags`.");
  expect(blocks[0]!.text).toContain("[the docs](https://example.com)");
  expect(blocks[0]!.text).toContain("`flags`");
});

// --- the regression this parser exists for ---------------------------------

test("a '#' comment inside a fenced code block is NOT a heading", () => {
  const md = [
    "# Real Heading",
    "",
    "Some prose.",
    "",
    "```python",
    "# this is a comment, not a heading",
    "x = 1",
    "# neither is this",
    "```",
    "",
    "More prose.",
  ].join("\n");

  const headings = parseMarkdown(md).blocks.filter((b) => b.type === "heading");
  expect(headings.map((h) => h.text)).toEqual(["Real Heading"]);
});

test("shell snippets don't shatter a document into fake sections", () => {
  const md = [
    "# Setup",
    "",
    "Run the installer:",
    "",
    "```bash",
    "# install deps",
    "bun install",
    "# build",
    "bun run build",
    "```",
    "",
    "Then open the app.",
  ].join("\n");

  // One heading → one section. The old line regex produced three.
  expect(toSections(parseMarkdown(md)).length).toBe(1);
});

test("indented code blocks are not headings either", () => {
  const md = "# Title\n\ntext\n\n    # indented code comment\n    y = 2\n";
  const headings = parseMarkdown(md).blocks.filter((b) => b.type === "heading");
  expect(headings.map((h) => h.text)).toEqual(["Title"]);
});

// --- sections ---------------------------------------------------------------

test("content before the first heading becomes a preamble section", () => {
  const sections = toSections(parseMarkdown("intro prose\n\n# First\n\nbody"));
  expect(sections.map((s) => s.heading)).toEqual(["", "First"]);
});

test("a body-less heading is kept as structure for the chunker to merge", () => {
  const sections = toSections(parseMarkdown("# Empty\n\n# Full\n\nbody"));
  expect(sections.map((s) => s.heading)).toEqual(["Empty", "Full"]);
  expect(sections[0]!.blocks).toEqual([]);
});
