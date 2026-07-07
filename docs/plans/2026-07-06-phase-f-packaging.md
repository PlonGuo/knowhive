# Phase F — Packaging & Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the dev-mode app into a distributable macOS .app: bundled sidecar + bundled bun runtime (no user-installed bun), Tauri-bundled, Electron and Python runtime remnants removed, root toolchain switched from pnpm to bun.

**Architecture (Path C, decided after the Task 0 spike):** `bun build --target=bun` produces one `index.js` bundle with the two native packages (`onnxruntime-node`, `sharp`) left external; the app ships the bun runtime as a Tauri `externalBin` plus a minimal real `node_modules` (just the externals + their transitive deps, installed by the build script) in resources. `sidecar.rs` spawns `bun index.js` in release (dev keeps `bun run src/index.ts`). This is the Electron/VS Code distribution shape — native modules load from disk exactly as designed, zero runtime tricks. The single-binary route (D) was spiked, proven viable, and deliberately not shipped — see `learnings/Bun-Compile-Native-Deps-Spike.md` for the four traps, the fixes, and the trade-off decision + revert triggers.

**Tech Stack:** bun (`build --target=bun`, runtime as externalBin), Tauri v2 (`externalBin` + resources), Rust (`sidecar.rs`), vitest (stays as the frontend test runner).

---

## Context: current wiring (read before starting)

- **Sidecar spawn:** `src-tauri/src/sidecar.rs` — `build_args()` produces `["run","src/index.ts","--port",…,"--data-dir",…]`; `spawn_child(&server_dir, port, &data_dir)` runs `bun` from `server_dir`. Unit tests exist for `build_args`/`RestartPolicy`/port discovery.
- **Server dir resolution:** `src-tauri/src/lib.rs:10-22` — debug: `<repo>/server`; release: `resource_dir()/server` (placeholder from Phase A; release path never exercised).
- **Tauri config:** `src-tauri/tauri.conf.json` — `beforeBuildCommand: "pnpm build:web"`, `bundle.targets: "all"`, **no `externalBin` yet**.
- **E2 native dep:** `@huggingface/transformers` → `onnxruntime-node` (.node addon, postinstall-fetched). `bun pm trust onnxruntime-node protobufjs` was required at install.
- **Electron remnants:** `electron/` (main.ts, preload.ts, port.ts, sidecar.ts), `electron.vite.config.ts`, `electron-builder.yml`, `tests/electron/` (7 files), `package.json` electron scripts (`dev`, `dev:all`, `build`, `build:dry`, `build:mac`, `build:win`) + deps (electron, electron-vite, electron-builder, concurrently, wait-on), `window.api` branches in `src/lib/platform.ts` + `src/env.d.ts`.
- **Python:** `backend/` stays in the repo as the dev/CI RAGAS eval tool — NOT deleted; just ensure nothing runtime references it.
- **Frontend tests:** vitest (`pnpm test`, 253 green). vitest stays after the bun switch (`bun run test` → vitest; `bun test` is NOT a vitest replacement for these DOM tests).
- **Model caches at runtime:** transformers.js caches under the OS cache dir; Ollama is an external user install. Verify persistence in the packaged app (Task 2).

---

## Task 0: Spike — `bun build --compile` with onnxruntime-node (GATE)

**Gate:** If the compiled binary can't serve `/health` and load the cross-encoder (`POST /reranker/download` exercises onnxruntime with no Ollama needed), the single-binary route is dead — pick a fallback (below) before proceeding. Throwaway artifacts only; nothing committed except (later) the chosen build script.

**Fallback options if compile fails on the native addon:**
- **B1:** `bun build --target=bun` (bundle to one .js, no --compile) + ship the `bun` runtime itself as the externalBin + the bundled .js + `onnxruntime-node` binaries as resources.
- **B2:** ship `server/` source + pruned `node_modules` as resources + bun runtime as externalBin (heaviest, last resort).

**Step 1: Compile**

Run:
```bash
cd server && mkdir -p ../src-tauri/binaries
bun build --compile src/index.ts --outfile /tmp/knowhive-sidecar-spike 2>&1 | tail -5
ls -lh /tmp/knowhive-sidecar-spike
```
Expected: a binary (likely 60-120MB). Note any warnings about `.node` files.

**Step 2: Run it against a scratch data dir**

Run:
```bash
D=$(mktemp -d); /tmp/knowhive-sidecar-spike --port 18310 --data-dir "$D" &
sleep 2 && curl -s http://127.0.0.1:18310/health
```
Expected: `{"status":"ok",...}` — proves bun:sqlite + Hono + fflate survive compilation.

**Step 3: Exercise the native addon (the actual risk)**

Run: `time curl -s --max-time 300 -X POST http://127.0.0.1:18310/reranker/download`
Expected: `{"status":"complete"}` (model loads from the shared HF cache; first-ever run downloads 571MB). If this throws (`Cannot find module`, dlopen error, missing .node), **STOP** — record the exact error, evaluate B1/B2, and get a decision before Task 1.

**Step 4: Check what the binary needs on disk**

Run the binary from an empty cwd (`cd /tmp && ...`) to confirm no implicit dependence on `server/` cwd (e.g. relative `node_modules` lookups for the .node file). Record findings + binary size + cold `/health` time. Kill the process, delete the spike binary.

---

## Task 1: Sidecar dist build (bundle + bun runtime + native node_modules) + release spawn path

**Files:**
- Create: `server/build-dist.ts` (dist builder)
- Modify: `server/src/crossEncoderModel.ts` (explicit model cache dir — .app resources are read-only)
- Modify: `server/src/index.ts` (call `setModelCacheDir(join(dataDir, "models"))`)
- Modify: `package.json` (add `build:sidecar` script)
- Modify: `src-tauri/tauri.conf.json` (externalBin bun + resources + beforeBuildCommand)
- Modify: `src-tauri/src/sidecar.rs` (release spawn: bundled bun + index.js)
- Test: `server/src/crossEncoderModel` cache-dir wiring (bun test) + `sidecar.rs` unit test for release args

**Step 1: Model cache dir (TDD the pure bit)** — failing test: `setModelCacheDir("/x")` makes the module's effective cache `/x` (export a getter for testability). Implement: module-level `let cacheDir`; `load()` sets `env.cacheDir = cacheDir` before `from_pretrained`. Wire `setModelCacheDir(join(dataDir, "models"))` in `index.ts` startup. Run `bun test` — green; dev now caches under the data dir (verify by deleting nothing — just check the path logs on next e2e).

**Step 2: `server/build-dist.ts`** — produces `src-tauri/resources/server/`:
1. `Bun.build({ entrypoints: ["src/index.ts"], target: "bun", external: ["onnxruntime-node", "sharp"], outdir: "../src-tauri/resources/server" })` → `index.js`
2. Write a synthetic `package.json` into the resources dir with `dependencies: { "onnxruntime-node": <version>, "sharp": <version> }` (versions read from `server/node_modules/*/package.json`), then run `bun install --production` there → real minimal `node_modules` with correct transitive deps + dylibs in place
3. Copy the running bun runtime: `cp $(which bun) src-tauri/binaries/bun-<target-triple>`

Run: `bun run build-dist.ts` → expected: `resources/server/{index.js,package.json,node_modules/}` + `binaries/bun-aarch64-apple-darwin`.

**Step 3: Smoke the dist layout directly (pre-Tauri proof)**

Run: `src-tauri/binaries/bun-<triple> src-tauri/resources/server/index.js --port 18315 --data-dir $(mktemp -d)` from an empty cwd; hit `/health` + `POST /reranker/download`. Expected: both pass — proves the resources layout is self-sufficient (bundle resolves externals from the sibling node_modules; model downloads into the data dir).

**Step 4: Rust release spawn (TDD)** — failing test: `release_spawn_args("/res/server", 18200, "/data")` = `["/res/server/index.js", "--port", "18200", "--data-dir", "/data"]`. Implement + in `spawn_child`: debug → `Command::new("bun").args(build_args(...)).current_dir(server_dir)`; release → `Command::new(current_exe_dir.join("bun")).args(release_spawn_args(server_dir, ...)).current_dir(server_dir)`. `cargo test` green.

**Step 5: Wire the build** — `package.json`: `"build:sidecar": "cd server && bun run build-dist.ts"`. `tauri.conf.json`: `"beforeBuildCommand": "pnpm build:web && pnpm build:sidecar"`, `bundle.externalBin: ["binaries/bun"]`, `bundle.resources: ["resources/server"]`. Add `src-tauri/binaries/` + `src-tauri/resources/` to `.gitignore`.

**Step 6: Verify dev mode untouched** (`bun test` server suite green; tauri:dev still uses `bun run src/index.ts`). Commit:

```bash
git add server/build-dist.ts server/src package.json src-tauri/tauri.conf.json src-tauri/src/sidecar.rs .gitignore
git commit -m "feat(tauri): sidecar dist bundle + bundled bun runtime spawn — Phase F (Path C)"
```

---

## Task 2: `tauri build` + packaged end-to-end verification (GATE)

**This is the release gate.** No code changes expected — a checklist against the built .app.

**Step 1: Build** — `pnpm tauri:build` (ad-hoc signing is fine; skip notarization). Expected: `.app` + `.dmg` under `src-tauri/target/release/bundle/`.

**Step 2: Install & run the .app** (copy to /Applications or run in place) with Ollama running. Verify in order:
1. App opens → sidecar status becomes running (no bun on PATH needed: `env -i open …` or temporarily `PATH=/usr/bin:/bin`)
2. Fresh data dir → onboarding shows; complete local flow
3. Import a .md → progress → chunks searchable; chat streams with sources
4. Settings → reranker download → status flips loaded; a chat with `use_reranker=true` works (cross-encoder in the packaged binary — the E2-in-production proof)
5. Watcher: drop a .md into the knowledge dir → auto-indexed
6. Export All → valid zip
7. Restart the app → data + model cache persist (no re-download)

**Step 3: Record** binary/bundle sizes and any deviation. If step 4 fails only in the packaged form, revisit Task 0 findings (cache path or .node resolution) before proceeding.

**Step 4: Commit** any fixes made, message `fix(tauri): packaged-app fixes from Phase F verification`.

---

## Task 3: Remove Electron

**Files:**
- Delete: `electron/`, `electron.vite.config.ts`, `electron-builder.yml`, `tests/electron/`
- Modify: `package.json` (drop scripts `dev`, `dev:all`, `build`, `build:dry`, `build:mac`, `build:win`; drop deps electron, electron-vite, electron-builder, concurrently, wait-on)
- Modify: `src/lib/platform.ts` (drop `window.api` branches → Tauri + browser-dev only)
- Modify: `src/env.d.ts` (drop `window.api` declaration)
- Check: `vitest.config.ts` / `tsconfig*.json` for electron path references

**Step 1:** `git rm -r electron electron.vite.config.ts electron-builder.yml tests/electron`
**Step 2:** Clean `package.json` scripts/deps; reinstall (`pnpm install`).
**Step 3:** Simplify `platform.ts`: each function keeps the `isTauri()` branch + browser-dev fallback; delete `hasElectronApi()` and `window.api!` calls. Delete the `window.api` interface in `env.d.ts`.
**Step 4:** `pnpm test` → all remaining tests green (electron tests are gone, count drops accordingly); `pnpm exec tsc --noEmit` → clean; grep `window.api|electron` in `src/` → no hits.
**Step 5:** Sanity: `pnpm tauri:dev` boots (dev flow unaffected). Commit: `chore: remove Electron shell — Tauri is the only shell (Phase F)`.

---

## Task 4: Root toolchain pnpm → bun

**Files:**
- Modify: `package.json` scripts (`pnpm` references → `bun run`), `src-tauri/tauri.conf.json` (`beforeDevCommand`/`beforeBuildCommand` pnpm → bun run)
- Create: root `bun.lock` (delete `pnpm-lock.yaml`)
- Check: README / HANDOFF run instructions

**Step 1:** `bun install` at root (generates bun.lock). Delete `pnpm-lock.yaml`.
**Step 2:** Update scripts: vitest stays (`"test": "vitest run"` — run via `bun run test`, NOT `bun test`). tauri.conf: `"beforeDevCommand": "bun run dev:web"`, `"beforeBuildCommand": "bun run build:web && bun run build:sidecar"`.
**Step 3:** Verify the full loop: `bun run test` (vitest green), `bun run tauri:dev` boots, `bun run tauri:build` completes.
**Step 4:** Update run instructions in `HANDOFF.md` + `README.md`. Commit: `chore: switch root toolchain to bun (pnpm retired) — Phase F`.

---

## Task 5: Docs + handoff

**Files:**
- Modify: `HANDOFF.md` (Phase F 完成 entry, new run commands, packaged-app notes)
- Modify: `README.md` (install/run for the packaged app)
- Modify: `learnings/Stack-Migration-and-RAGAS-Validation.md` §8 (onnxruntime-in-compile verdict — close the risk item)

**Step 1:** Write the updates (include Task 0's verdict + Task 2's measured sizes/latencies).
**Step 2:** Full suites one last time: `cd server && bun test`, `bun run test`, `cd src-tauri && cargo test`.
**Step 3:** Commit: `docs: Phase F complete — distributable app, migration closed`.

---

## Risks & open questions

1. **onnxruntime-node in `bun build --compile`** (Task 0 gate). Known bun limitation area: `.node` addons may need to sit on disk next to the binary. Fallbacks B1/B2 documented above.
2. **transformers.js cache path in a packaged app** — sandboxed/translocated apps can get odd HOME/cache paths; Task 2 step 7 (restart persistence) catches it. Fix would be pinning `env.cacheDir` to the app data dir.
3. **Ad-hoc signing / Gatekeeper** — unsigned dev builds may need right-click-open; fine for a portfolio project, note in README.
4. **`bundle.targets: "all"`** — trims to `["app","dmg"]` if non-mac targets break the build (we only verify macOS here).
5. **Root bun switch breaking vitest/Tauri CLI invocation** — mitigated by keeping vitest as the runner and only changing the package manager layer; Task 4 verifies all three loops before commit.
