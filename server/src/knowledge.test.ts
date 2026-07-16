import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { buildTree, createNoteFile, flattenTree, resolveSafePath, SafePathError, updateNoteFile } from "./knowledge.ts";

// Parity tests against backend/app/routers/knowledge.py (_build_tree, _resolve_safe_path).

function makeKnowledgeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "knowhive-knowledge-"));
  // Layout exercises ordering: dirs before files, case-insensitive alpha within each group.
  mkdirSync(join(dir, "b-topics"));
  mkdirSync(join(dir, "Algo"));
  writeFileSync(join(dir, "zebra.md"), "# z");
  writeFileSync(join(dir, "Apple.md"), "# a");
  writeFileSync(join(dir, "Algo", "sort.md"), "# sort");
  return dir;
}

test("buildTree returns root node with empty path and directory type", () => {
  const dir = makeKnowledgeDir();
  const tree = buildTree(dir);
  expect(tree.path).toBe("");
  expect(tree.type).toBe("directory");
  expect(tree.name).toBe(basename(dir));
});

test("buildTree sorts directories first, then files, case-insensitively", () => {
  const tree = buildTree(makeKnowledgeDir());
  expect(tree.children!.map((c) => c.name)).toEqual(["Algo", "b-topics", "Apple.md", "zebra.md"]);
});

test("buildTree recurses into subdirectories with relative paths", () => {
  const tree = buildTree(makeKnowledgeDir());
  const algo = tree.children!.find((c) => c.name === "Algo")!;
  expect(algo.type).toBe("directory");
  expect(algo.path).toBe("Algo");
  expect(algo.children).toEqual([{ name: "sort.md", path: join("Algo", "sort.md"), type: "file" }]);
});

test("resolveSafePath resolves a nested relative path inside the root", () => {
  const dir = makeKnowledgeDir();
  expect(resolveSafePath(dir, "Algo/sort.md")).toBe(join(dir, "Algo", "sort.md"));
});

test("resolveSafePath rejects absolute paths", () => {
  expect(() => resolveSafePath(makeKnowledgeDir(), "/etc/passwd")).toThrow(SafePathError);
});

test("resolveSafePath rejects traversal outside the root", () => {
  expect(() => resolveSafePath(makeKnowledgeDir(), "../escape.md")).toThrow(SafePathError);
  expect(() => resolveSafePath(makeKnowledgeDir(), "Algo/../../escape.md")).toThrow(SafePathError);
});

test("flattenTree returns file paths only, depth-first (empty dirs contribute nothing)", () => {
  const tree = buildTree(makeKnowledgeDir());
  expect(flattenTree(tree)).toEqual([join("Algo", "sort.md"), "Apple.md", "zebra.md"]);
});

test("createNoteFile writes a new file, creating parent dirs; refuses to overwrite", () => {
  const dir = makeKnowledgeDir();
  const abs = createNoteFile(dir, "new/notes/idea.md", "# idea");
  expect(abs.endsWith(join("new", "notes", "idea.md"))).toBe(true);
  expect(() => createNoteFile(dir, "new/notes/idea.md", "again")).toThrow(/exists/i);
  expect(() => createNoteFile(dir, "../escape.md", "x")).toThrow(SafePathError);
});

test("updateNoteFile overwrites an existing file; refuses missing paths and dirs", () => {
  const dir = makeKnowledgeDir();
  updateNoteFile(dir, "Apple.md", "# updated");
  expect(() => updateNoteFile(dir, "nope.md", "x")).toThrow(/not found/i);
  expect(() => updateNoteFile(dir, "Algo", "x")).toThrow(/director/i);
});
