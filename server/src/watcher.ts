// Knowledge-dir file watcher with debounce + extension filter + overlap guard.
// Ports backend/app/services/file_watcher.py + watcher_bridge.py on top of fs.watch.
// The event core (onFsEvent) is separated from the fs.watch wiring so debounce and
// filtering are deterministically unit-testable.
import { watch, type FSWatcher } from "node:fs";
import { extname } from "node:path";

export interface FileWatcherOptions {
  knowledgeDir: string;
  /** Sync callback fired after the debounce window. Overlapping runs are skipped. */
  onChange: () => Promise<void>;
  debounceMs?: number;
  extensions?: string[];
}

export interface WatcherStatus {
  running: boolean;
  knowledge_dir: string;
  extensions: string[];
  syncing: boolean;
}

const DEFAULT_DEBOUNCE_MS = 1000;
// Python watched {.md, .pdf}; the TS ingest pipeline has no PDF support yet.
const DEFAULT_EXTENSIONS = [".md"];

export class FileWatcher {
  private readonly knowledgeDir: string;
  private readonly onChange: () => Promise<void>;
  private readonly debounceMs: number;
  private readonly extensions: string[];
  private fsWatcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private syncing = false;

  constructor(opts: FileWatcherOptions) {
    this.knowledgeDir = opts.knowledgeDir;
    this.onChange = opts.onChange;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
  }

  start(): void {
    if (this.running) return;
    this.fsWatcher = watch(this.knowledgeDir, { recursive: true }, (_event, filename) => {
      this.onFsEvent(filename);
    });
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.fsWatcher?.close();
    this.fsWatcher = null;
    this.running = false;
  }

  /** Debounced, extension-filtered event entry point (called by fs.watch). */
  onFsEvent(path: string | Buffer | null): void {
    if (path == null) return;
    if (!this.extensions.includes(extname(path.toString()).toLowerCase())) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire();
    }, this.debounceMs);
  }

  private fire(): void {
    if (this.syncing) return; // a sync pass is already in flight — skip (bridge parity)
    this.syncing = true;
    this.onChange()
      .catch((err) => console.error("[watcher] sync failed:", err))
      .finally(() => {
        this.syncing = false;
      });
  }

  status(): WatcherStatus {
    return {
      running: this.running,
      knowledge_dir: this.knowledgeDir,
      extensions: [...this.extensions].sort(),
      syncing: this.syncing,
    };
  }
}
