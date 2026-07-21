import { test, expect } from "bun:test";
import { parseFrontmatter } from "./frontmatter.ts";

test("no frontmatter returns empty data and original text", () => {
  const { data, body } = parseFrontmatter("# Hello\nbody");
  expect(data.title).toBeNull();
  expect(data.tags).toEqual([]);
  expect(body).toBe("# Hello\nbody");
});

test("parses fields and returns the body after the block", () => {
  const text =
    "---\ntitle: Attention\ncategory: ML\ndifficulty: hard\npack_id: p1\n---\nThe body.";
  const { data, body } = parseFrontmatter(text);
  expect(data.title).toBe("Attention");
  expect(data.category).toBe("ML");
  expect(data.difficulty).toBe("hard");
  expect(data.pack_id).toBe("p1");
  expect(body).toBe("The body.");
});

test("tags as a string becomes a single-element list", () => {
  const { data } = parseFrontmatter("---\ntags: solo\n---\nx");
  expect(data.tags).toEqual(["solo"]);
});

test("tags as a list is preserved", () => {
  const { data } = parseFrontmatter("---\ntags:\n  - a\n  - b\n---\nx");
  expect(data.tags).toEqual(["a", "b"]);
});

test("non-mapping frontmatter falls back to empty data + body", () => {
  const { data, body } = parseFrontmatter("---\njust a scalar\n---\nreal body");
  expect(data.title).toBeNull();
  expect(body).toBe("real body");
});
