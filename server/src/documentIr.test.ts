import { test, expect } from "bun:test";
import { profileDocument, toSections } from "./documentIr.ts";
import { parseMarkdown } from "./markdownIr.ts";

const profile = (md: string) => profileDocument(parseMarkdown(md));

test("headingless prose is flagged, with zero heading density", () => {
  const p = profile("Just prose.\n\nMore prose with no structure at all.");
  expect(p.headingless).toBe(true);
  expect(p.headingDensity).toBe(0);
  expect(p.sections).toBe(1);
});

test("heading-dense notes report short median sections", () => {
  const md = Array.from({ length: 10 }, (_, i) => `## S${i}\n\n${"x".repeat(120)}`).join("\n\n");
  const p = profile(md);
  expect(p.headingless).toBe(false);
  expect(p.headingDensity).toBeGreaterThan(5);
  expect(p.medianSectionLength).toBeLessThan(200);
});

test("code ratio reflects how much of the document is code", () => {
  const p = profile("# T\n\nshort prose\n\n```py\n" + "x = 1\n".repeat(50) + "```");
  expect(p.codeRatio).toBeGreaterThan(0.8);
});

test("tables are measured separately from prose", () => {
  const p = profile("# T\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
  expect(p.tableRatio).toBeGreaterThan(0);
});

test("an empty document profiles to zeros without dividing by zero", () => {
  const p = profile("");
  expect(p.chars).toBe(0);
  expect(p.headingDensity).toBe(0);
  expect(p.codeRatio).toBe(0);
  expect(p.medianSectionLength).toBe(0);
});

test("max section length exposes the outlier a median hides", () => {
  const p = profile("# A\n\nshort\n\n# B\n\n" + "y".repeat(5000));
  expect(p.maxSectionLength).toBeGreaterThan(4000);
  expect(p.medianSectionLength).toBeLessThan(p.maxSectionLength);
});
