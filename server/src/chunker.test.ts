import { test, expect } from "bun:test";
import { chooseStrategy, chunkDocument, recursiveSplit } from "./chunker.ts";
import { parseMarkdown } from "./markdownIr.ts";
import type { DocumentProfile } from "./documentIr.ts";

/** Markdown → IR → chunks, the path ingest.ts takes. */
const chunk = (md: string) => chunkDocument(parseMarkdown(md));

test("empty or whitespace text yields no chunks", () => {
  expect(chunk("")).toEqual({ parents: [], children: [], strategy: "empty" });
  expect(chunk("   \n  ")).toEqual({ parents: [], children: [], strategy: "empty" });
});

test("a tiny document becomes one whole-doc chunk, headings kept inline", () => {
  const md = ["# Intro", "x".repeat(150), "## Details", "y".repeat(150)].join("\n\n");
  const { parents, children, strategy } = chunk(md);
  expect(strategy).toBe("whole-doc");
  expect(children.length).toBe(1);
  expect(parents.length).toBe(1);
  expect(parents[0]!.content).toBe(children[0]!.content);
  expect(children[0]!.content).toContain("# Intro");
  expect(children[0]!.content).toContain("## Details");
  expect(children[0]!.section_heading).toBe("Intro");
});

test("chunkDocument labels the strategy it routed to", () => {
  expect(chunk("word ".repeat(500).trim()).strategy).toBe("sliding-window");
  const dense = ["# A", "x".repeat(600), "# B", "y".repeat(600)].join("\n\n");
  expect(chunk(dense).strategy).toBe("section-as-chunk");
  expect(chunk("# Long\n\n" + "word ".repeat(500).trim()).strategy).toBe("parent-child");
});

test("no headings: a single chunk with empty section_heading", () => {
  const { children } = chunk("Just some prose about cats and dogs.");
  expect(children.length).toBe(1);
  expect(children[0]!.section_heading).toBe("");
  expect(children[0]!.chunk_index).toBe(0);
});

test("splits by headings, recording section_heading and incrementing index", () => {
  const md = ["# Intro", "x".repeat(600), "## Details", "y".repeat(600)].join("\n\n");
  const { children } = chunk(md);
  expect(children.length).toBe(2);
  expect(children[0]!.section_heading).toBe("Intro");
  expect(children[1]!.section_heading).toBe("Details");
  expect(children.map((c) => c.chunk_index)).toEqual([0, 1]);
});

test("a short section (<100 chars) is merged into the next", () => {
  const md = ["# Tiny", "short", "# Big", "z".repeat(600), "# Other", "w".repeat(600)].join("\n\n");
  const { children } = chunk(md);
  expect(children.length).toBe(2);
  expect(children[0]!.content).toContain("short");
  expect(children[0]!.content).toContain("z".repeat(600));
});

test("a long section (>1500 chars) is sub-split into multiple indexed chunks", () => {
  const long = "word ".repeat(500).trim(); // ~2500 chars
  const { children } = chunk("# Long\n\n" + long);
  expect(children.length).toBeGreaterThan(1);
  expect(children.every((c) => c.section_heading === "Long")).toBe(true);
  expect(children.map((c) => c.chunk_index)).toEqual(children.map((_, i) => i));
  expect(children.every((c) => c.content.length <= 1100)).toBe(true);
});

// --- parent/child -----------------------------------------------------------

test("every child points at a real parent", () => {
  const { parents, children } = chunk("# Long\n\n" + "word ".repeat(500).trim());
  expect(parents.length).toBeGreaterThan(0);
  for (const c of children) {
    expect(parents[c.parent_index]).toBeDefined();
    expect(parents[c.parent_index]!.parent_index).toBe(c.parent_index);
  }
});

test("a child's text is contained in its parent — expansion never changes the subject", () => {
  const { parents, children } = chunk("# Long\n\n" + "word ".repeat(500).trim());
  for (const c of children) {
    expect(parents[c.parent_index]!.content).toContain(c.content);
  }
});

test("the parent is the wider passage: bigger than the child that matched", () => {
  const { parents, children } = chunk("# Long\n\n" + "word ".repeat(500).trim());
  const widened = children.filter(
    (c) => parents[c.parent_index]!.content.length > c.content.length,
  );
  expect(widened.length).toBeGreaterThan(0);
});

test("a section that fits in one chunk has parent === child", () => {
  const md = ["# A", "x".repeat(600), "# B", "y".repeat(600)].join("\n\n");
  const { parents, children } = chunk(md);
  expect(parents.length).toBe(2);
  expect(children.length).toBe(2);
  for (const c of children) {
    expect(parents[c.parent_index]!.content).toBe(c.content);
  }
});

test("parents are capped so expansion can't paste a whole chapter into the prompt", () => {
  const huge = "word ".repeat(4000).trim(); // ~20k chars
  const { parents } = chunk("# Huge\n\n" + huge);
  expect(parents.length).toBeGreaterThan(1);
  expect(parents.every((p) => p.content.length <= 4400)).toBe(true);
});

test("children never straddle a parent boundary", () => {
  const { parents, children } = chunk("# Huge\n\n" + "word ".repeat(4000).trim());
  // If a child spanned two parents, it could not be a substring of either.
  for (const c of children) {
    expect(parents[c.parent_index]!.content.includes(c.content)).toBe(true);
  }
});

// --- block-aware splitting ---------------------------------------------------

test("a code block that fits a child is never cut, even mid-blank-line", () => {
  // Two ~400-char halves separated by a blank line: a text splitter breaks at the blank
  // line and glues half the code to the preceding prose; a block-aware one must not.
  const code = "```python\n" + "a".repeat(390) + "\n\n" + "b".repeat(390) + "\n```";
  const md = "# S\n\n" + "x".repeat(400) + "\n\n" + code;
  const { children } = chunk(md);
  expect(children.some((c) => c.content.includes(code))).toBe(true);
});

test("an oversized code block splits on line boundaries only, unmixed with prose", () => {
  const codeLines = Array.from({ length: 30 }, (_, i) => `line-${i} ` + "c".repeat(42));
  // Blank line between stanzas — the classic function-gap a text splitter breaks on.
  const stanzas = [codeLines.slice(0, 10), codeLines.slice(10, 20), codeLines.slice(20)];
  const code = "```js\n" + stanzas.map((s) => s.join("\n")).join("\n\n") + "\n```"; // ~1500 chars
  const prose = "p".repeat(300);
  const md = "# S\n\n" + prose + "\n\n" + code;
  const { children } = chunk(md);

  const codeChildren = children.filter((c) => c.content.includes("line-"));
  expect(codeChildren.length).toBeGreaterThan(1);
  // No child mixes prose into the code block.
  expect(codeChildren.every((c) => !c.content.includes(prose))).toBe(true);
  // Every line in a code child is a complete original line — no mid-line cuts.
  const wholeLines = new Set(["```js", "```", ...codeLines]);
  for (const c of codeChildren) {
    expect(c.content.split("\n").every((l) => l === "" || wholeLines.has(l))).toBe(true);
  }
});

test("an oversized table splits by rows and repeats the header in every child", () => {
  const header = "| name | value | detail |";
  const sep = "| --- | --- | --- |";
  const rows = Array.from({ length: 30 }, (_, i) => `| row-${i} | ${"v".repeat(20)} | ${"d".repeat(20)} |`);
  const md = "# T\n\n" + [header, sep, ...rows].join("\n"); // ~1600 chars, must split
  const { children } = chunk(md);

  const tableChildren = children.filter((c) => c.content.includes("row-"));
  expect(tableChildren.length).toBeGreaterThan(1);
  for (const c of tableChildren) {
    expect(c.content.startsWith(header + "\n" + sep)).toBe(true);
  }
});

// --- strategy routing --------------------------------------------------------

/** A plausible profile with every field present; tests override what they route on. */
const profile = (over: Partial<DocumentProfile>): DocumentProfile => ({
  format: "md",
  chars: 5000,
  blocks: 10,
  sections: 5,
  headingDensity: 1,
  medianSectionLength: 800,
  maxSectionLength: 2000,
  codeRatio: 0,
  tableRatio: 0,
  headingless: false,
  ...over,
});

test("chooseStrategy: empty document", () => {
  expect(chooseStrategy(profile({ chars: 0 }))).toBe("empty");
});

test("chooseStrategy: tiny document is stored whole, even without headings", () => {
  expect(chooseStrategy(profile({ chars: 800 }))).toBe("whole-doc");
  expect(chooseStrategy(profile({ chars: 800, headingless: true }))).toBe("whole-doc");
});

test("chooseStrategy: long headingless document slides a window", () => {
  expect(chooseStrategy(profile({ headingless: true }))).toBe("sliding-window");
});

test("chooseStrategy: chunk-sized sections mean section == chunk", () => {
  expect(chooseStrategy(profile({ medianSectionLength: 400 }))).toBe("section-as-chunk");
});

test("chooseStrategy: long sections get true parent-child splitting", () => {
  expect(chooseStrategy(profile({ medianSectionLength: 2000 }))).toBe("parent-child");
});

test("recursiveSplit yields multiple pieces bounded by chunkSize", () => {
  const text = Array.from(
    { length: 20 },
    (_, i) => `Paragraph number ${i} with some filler text.`,
  ).join("\n\n");
  const pieces = recursiveSplit(text, 120, 30);
  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.every((p) => p.length <= 180)).toBe(true);
});
