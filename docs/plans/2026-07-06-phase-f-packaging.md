# Phase F — Packaging & Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the dev-mode app into a distributable macOS .app: compiled sidecar binary (no user-installed bun), Tauri-bundled, Electron and Python runtime remnants removed, root toolchain switched from pnpm to bun.

**Architecture:** `bun build --compile` produces a self-contained sidecar executable that Tauri ships as an `externalBin`; `sidecar.rs` spawns it in release builds (dev keeps `bun run src/index.ts`). The one unknown that gates everything is whether `onnxruntime-node` (the Phase E2 native addon) survives compilation — Task 0 spikes it with documented fallbacks. Cleanup (Electron removal, root bun switch) happens only after the packaged app is proven.

**Tech Stack:** bun (`build --compile`), Tauri v2 (`externalBin`, resource dir), Rust (`sidecar.rs`), vitest (stays as the frontend test runner).

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

## Task 1: Sidecar build script + release spawn path

**Files:**
- Modify: `package.json` (add `build:sidecar` script)
- Modify: `src-tauri/tauri.conf.json` (externalBin + beforeBuildCommand)
- Modify: `src-tauri/src/sidecar.rs` (spawn compiled binary in release)
- Modify: `src-tauri/src/lib.rs` (resolve binary path in release)
- Test: `src-tauri/src/sidecar.rs` unit tests (arg builder for the binary form)

**Step 1: Write the failing Rust test** (in `sidecar.rs` `#[cfg(test)]`)

```rust
#[test]
fn binary_args_omit_bun_run() {
    let args = build_binary_args(18200, "/data");
    assert_eq!(args, vec!["--port", "18200", "--data-dir", "/data"]);
}
```

**Step 2: Run to verify it fails** — `cd src-tauri && cargo test binary_args` → compile error (function missing).

**Step 3: Implement** — add `build_binary_args(port, data_dir)` (no `run src/index.ts` prefix); in the spawn path, choose per build profile:

```rust
// spawn_child: debug → Command::new("bun").args(build_args(...)).current_dir(server_dir)
//              release → Command::new(sidecar_binary_path()).args(build_binary_args(...))
```

`sidecar_binary_path()`: `std::env::current_exe()?.parent()?.join("knowhive-sidecar")` (Tauri places externalBin next to the app executable). Keep `SidecarManager` construction unchanged (server_dir still passed; unused in release path).

**Step 4: Run tests** — `cargo test` → PASS; `cargo check` clean.

**Step 5: Wire the build** — `package.json`:
```json
"build:sidecar": "cd server && bun build --compile src/index.ts --outfile ../src-tauri/binaries/knowhive-sidecar-$(rustc -vV | sed -n 's/host: //p')"
```
`tauri.conf.json`: `"beforeBuildCommand": "pnpm build:web && pnpm build:sidecar"`, and under `bundle`: `"externalBin": ["binaries/knowhive-sidecar"]`. Add `src-tauri/binaries/` to `.gitignore`.

**Step 6: Verify dev mode is untouched** — `pnpm tauri:dev` still spawns `bun run` (debug path). Commit.

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/src/sidecar.rs src-tauri/src/lib.rs .gitignore
git commit -m "feat(tauri): compile sidecar to externalBin, spawn binary in release — Phase F"
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
