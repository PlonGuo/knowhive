// Filesystem ↔ DB sync: new files → embed, modified → re-embed, deleted → remove.
// Ports backend/app/services/sync_service.py.
import type { Database } from "bun:sqlite";
import { findMarkdownFiles } from "./ingest.ts";
import { deleteChunksForFile } from "./store.ts";

export interface SyncStats {
  new: number;
  modified: number;
  deleted: number;
  errors: string[];
}

export async function syncKnowledgeDir(
  db: Database,
  knowledgeDir: string,
  ingestFile: (absPath: string) => Promise<void>,
): Promise<SyncStats> {
  const stats: SyncStats = { new: 0, modified: 0, deleted: 0, errors: [] };

  const diskPaths = new Set(await findMarkdownFiles(knowledgeDir));
  const dbRows = db.query("SELECT file_path, file_hash FROM documents").all() as {
    file_path: string;
    file_hash: string | null;
  }[];
  const dbHashes = new Map(dbRows.map((r) => [r.file_path, r.file_hash]));

  for (const path of [...diskPaths].sort()) {
    const known = dbHashes.has(path);
    try {
      if (!known) {
        await ingestFile(path);
        stats.new++;
        continue;
      }
      const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(path).text()).digest("hex");
      if (hash !== dbHashes.get(path)) {
        await ingestFile(path);
        stats.modified++;
      }
    } catch (err) {
      stats.errors.push(`${known ? "Re-embed" : "New file"} error: ${path}: ${(err as Error).message}`);
    }
  }

  for (const path of [...dbHashes.keys()].filter((p) => !diskPaths.has(p)).sort()) {
    try {
      deleteChunksForFile(db, path);
      db.run("DELETE FROM documents WHERE file_path = ?", [path]);
      stats.deleted++;
    } catch (err) {
      stats.errors.push(`Delete error: ${path}: ${(err as Error).message}`);
    }
  }

  return stats;
}
