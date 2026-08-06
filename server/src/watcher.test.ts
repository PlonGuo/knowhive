import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileWatcher } from "./watcher.ts";

// Parity tests against backend/app/services/file_watcher.py + watcher_bridge.py:
// debounce coalescing, extension filter, overlapping-sync guard, status shape.
// The debounce/filter core is driven directly via onFsEvent (deterministic);
// real fs.watch wiring is covered by the live e2e.

function makeWatcher(over: { debounceMs?: number; onChange?: () => Promise<void> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "knowhive-watch-"));
  const calls: number[] = [];
  const watcher = new FileWatcher({
    knowledgeDir: dir,
    debounceMs: over.debounceMs ?? 20,
    onChange:
      over.onChange ??
      (async () => {
        calls.push(calls.length);
      }),
  });
  return { dir, watcher, calls };
}

test("status reports running=false, dir and extensions before start", () => {
  const { dir, watcher } = makeWatcher();
  expect(watcher.status()).toEqual({
    running: false,
    knowledge_dir: dir,
    extensions: [".docx", ".md", ".txt"],
    syncing: false,
  });
});

test("start/stop flip running and are idempotent", () => {
  const { watcher } = makeWatcher();
  watcher.start();
  watcher.start();
  expect(watcher.status().running).toBe(true);
  watcher.stop();
  watcher.stop();
  expect(watcher.status().running).toBe(false);
});

test("a burst of events fires onChange once after the debounce window", async () => {
  const { watcher, calls } = makeWatcher();
  watcher.onFsEvent("a.md");
  watcher.onFsEvent("b.md");
  watcher.onFsEvent("nested/c.md");
  await Bun.sleep(60);
  expect(calls.length).toBe(1);
});

test("events for unwatched extensions are ignored", async () => {
  const { watcher, calls } = makeWatcher();
  // .pdf is deliberately NOT watched: a dropped-in PDF must not trigger a docling
  // model load from a background file event (see watcher.ts DEFAULT_EXTENSIONS).
  watcher.onFsEvent("scan.pdf");
  watcher.onFsEvent("notes.png");
  watcher.onFsEvent(".DS_Store");
  await Bun.sleep(60);
  expect(calls.length).toBe(0);
});

test("a change during a running sync does not start an overlapping sync", async () => {
  let active = 0;
  let overlapped = false;
  let resolveFirst: () => void;
  const gate = new Promise<void>((r) => {
    resolveFirst = r;
  });
  const { watcher } = makeWatcher({
    onChange: async () => {
      active++;
      if (active > 1) overlapped = true;
      await gate;
      active--;
    },
  });
  watcher.onFsEvent("a.md");
  await Bun.sleep(40); // first sync now in-flight, blocked on gate
  expect(watcher.status().syncing).toBe(true);
  watcher.onFsEvent("b.md");
  await Bun.sleep(40); // debounce fires again while sync 1 still running → skipped
  resolveFirst!();
  await Bun.sleep(20);
  expect(overlapped).toBe(false);
  expect(watcher.status().syncing).toBe(false);
});

test("real fs.watch delivers events after start (integration smoke)", async () => {
  const { dir, watcher, calls } = makeWatcher();
  watcher.start();
  writeFileSync(join(dir, "hello.md"), "# hi");
  // Waits up to 5s, not 1s. The bound is patience, not an assertion: the loop exits on
  // the first event, so a healthy run is exactly as fast as before and only a loaded
  // machine spends the extra time. At 1s this failed ~8% of the time (3/36 runs, and
  // 1/15 on a tree with no local changes at all) because macOS fs.watch delivery plus
  // the 20ms debounce does not fit in a second when the box is busy -- a test that
  // reports a real defect 8% of the time is worse than no test.
  for (let i = 0; i < 500 && calls.length === 0; i++) await Bun.sleep(10);
  watcher.stop();
  expect(calls.length).toBe(1);
});
