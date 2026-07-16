// Knowledge-dir helpers: file tree building + safe path resolution.
// Ports backend/app/routers/knowledge.py (_build_tree, _resolve_safe_path).
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

/** Raised when a requested path is absolute or escapes the knowledge root. Routes map it to 400. */
export class SafePathError extends Error {}

export function buildTree(root: string): TreeNode {
  return {
    name: basename(root),
    path: "",
    type: "directory",
    children: buildChildren(root, root),
  };
}

function buildChildren(directory: string, base: string): TreeNode[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  // Directories first, then files; case-insensitive alpha within each group (parity
  // with Python's sort key `(not is_dir, name.lower())`).
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });

  return entries.map((entry) => {
    const abs = join(directory, entry.name);
    const rel = abs.slice(base.length + 1);
    return entry.isDirectory()
      ? { name: entry.name, path: rel, type: "directory" as const, children: buildChildren(abs, base) }
      : { name: entry.name, path: rel, type: "file" as const };
  });
}

/** Models echo the absolute paths they see in search results — tolerate absolute
 * paths that live inside the knowledge root by relativizing them. Foreign absolute
 * paths pass through unchanged and get rejected by resolveSafePath downstream. */
export function relativizeIfInside(root: string, p: string): string {
  const resolvedRoot = resolve(root);
  return p.startsWith(resolvedRoot + sep) ? p.slice(resolvedRoot.length + 1) : p;
}

/** Create a new note (agent write tool + future UI). Refuses to overwrite. */
export function createNoteFile(root: string, relPath: string, content: string): string {
  const resolved = resolveSafePath(root, relPath);
  if (existsSync(resolved)) throw new Error(`File already exists: ${relPath}`);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content);
  return resolved;
}

/** Overwrite an existing note's content. */
export function updateNoteFile(root: string, relPath: string, content: string): string {
  const resolved = resolveSafePath(root, relPath);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    throw new Error(`Cannot write to a directory: ${relPath}`);
  }
  if (!existsSync(resolved)) throw new Error(`File not found: ${relPath}`);
  writeFileSync(resolved, content);
  return resolved;
}

/** Flatten a tree into file paths only, depth-first (tree order: dirs first, alpha). */
export function flattenTree(node: TreeNode): string[] {
  if (node.type === "file") return [node.path];
  return (node.children ?? []).flatMap(flattenTree);
}

/** Resolve a relative path within the knowledge dir, blocking traversal and absolute paths. */
export function resolveSafePath(root: string, relPath: string): string {
  if (relPath.startsWith("/")) {
    throw new SafePathError("Absolute paths are not allowed");
  }
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, relPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new SafePathError("Path traversal is not allowed");
  }
  return resolved;
}
