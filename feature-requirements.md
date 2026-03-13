# KnowHive — Feature Requirements (Ralph Loop)

**Plan version**: v1.1
**Generated**: 2026-03-12
**Scope**: Phase 0 (rename) + Phase 1 (POC packaging validation)

---

## Phase 0: Project Rename

- [ ] Task 1: Rename GitHub repo — Go to github.com/PlonGuo/Local-AI-knowledge-base-tool → Settings → rename to `knowhive` — verified by: manual browser confirmation (old URL 301 redirects)
- [ ] Task 2: Rename local directory and update git remote — `mv ~/Git/Local-AI-knowledge-base-tool ~/Git/knowhive` then `git remote set-url origin git@github.com:PlonGuo/knowhive.git` — verified by: `git remote -v` shows new URL
- [ ] Task 3: Update PRD repo path reference — edit `docs/PRD.md` to replace `Local-AI-knowledge-base-tool` with `knowhive` — verified by: `grep -r "Local-AI-knowledge-base-tool" docs/` returns empty

---

## Phase 1: POC — Electron + FastAPI Packaging Validation

### 1A. Project Scaffolding

- [ ] Task 4: Initialize frontend scaffold — set up `package.json` with Electron 28+, Vite, React 18, TypeScript, Tailwind CSS, shadcn/ui, electron-builder; configure `tsconfig.json`, `vite.config.ts`, `tailwind.config.ts` — verified by: `pnpm install` succeeds, `pnpm dev` starts Vite dev server without errors
- [ ] Task 5: Initialize backend scaffold — create `backend/pyproject.toml` with FastAPI, uvicorn, pydantic; run `uv sync` to generate `uv.lock` — verified by: `cd backend && uv run python -c "import fastapi; print(fastapi.__version__)"` succeeds

### 1B. FastAPI Sidecar (Backend)

- [ ] Task 6: Implement FastAPI app entry point with CLI `--port` argument — `backend/app/main.py` accepts `--port` arg, starts uvicorn on `127.0.0.1:<port>` — verified by: `uv run python -m app.main --port 18234` starts server; `curl http://127.0.0.1:18234/health` returns `{"status":"ok","version":"0.1.0"}`
- [ ] Task 7: Implement health endpoint `GET /health` — verified by: `pytest backend/tests/test_health.py` passes
- [ ] Task 8: Implement file-based logging — FastAPI writes to `logs/backend.log` with daily rotation (7-day retention); dev mode also prints to terminal — verified by: after starting server, `logs/backend.log` exists and contains startup entries

### 1C. Electron Main Process

- [ ] Task 9: Implement Electron main process with BrowserWindow — `electron/main.ts` creates window, loads Vite dev server URL in dev mode — verified by: `pnpm dev` shows Electron window with Vite content
- [ ] Task 10: Implement dynamic port selection — `electron/sidecar.ts` uses `get-port` to find free port, passes to FastAPI as `--port` arg — verified by: two simultaneous instances use different ports (manual test)
- [ ] Task 11: Implement FastAPI sidecar manager — `electron/sidecar.ts` spawns python subprocess, polls `/health` until 200, captures stdout/stderr to `logs/electron.log`, handles graceful shutdown (SIGTERM → wait → force kill), auto-restart on crash (max 3 times) — verified by: `pnpm dev` logs show "FastAPI sidecar ready" in console; killing sidecar process triggers auto-restart
- [ ] Task 12: Implement IPC bridge — `electron/preload.ts` exposes `window.api.getBackendUrl()` via contextBridge so renderer can call FastAPI — verified by: renderer can fetch backend URL without `nodeIntegration`

### 1D. React Frontend (POC)

- [ ] Task 13: Implement minimal React app that calls `/health` and displays result — `src/App.tsx` fetches `GET /health` on load, shows `{"status":"ok"}` in UI — verified by: `pnpm dev` shows backend status in browser/Electron window
- [ ] Task 14: Implement `pnpm dev:all` script — `package.json` script starts Vite + uvicorn + Electron in parallel (using `concurrently`) — verified by: `pnpm dev:all` launches all three processes; Electron window shows FastAPI health response

### 1E. Packaging & Distribution

- [ ] Task 15: Configure `electron-builder.yml` — set up extraResources for `python/` (python-build-standalone) and `backend/` (app code + .venv), configure macOS target (.dmg + .app), enable hardened runtime for code signing — verified by: `electron-builder.yml` is valid YAML, `pnpm build:dry` (no actual build) passes config validation
- [ ] Task 16: Write build script `scripts/build-backend.sh` — installs python-build-standalone, runs `uv sync --no-dev` in backend/, packages result into `extraResources/` — verified by: script runs without error on macOS, `extraResources/python/bin/python3.11` exists, `extraResources/backend/.venv/` contains site-packages
- [ ] Task 17: Update sidecar.ts for packaged mode — detect `app.isPackaged`, resolve python binary and backend path from `extraResources/`, use embedded python to run FastAPI — verified by: `pnpm build` produces `.app`; opening it (no system Python required) shows Electron window with FastAPI health response; packaged `.app` total size < 500MB (excluding embedding models)

---

## Verification Commands Summary

```bash
# Backend unit tests
cd backend && uv run pytest tests/ -v

# Frontend type check
pnpm tsc --noEmit

# Frontend lint
pnpm lint

# Dev mode smoke test
pnpm dev:all  # manual: verify Electron window shows {"status":"ok"}

# Package size check
du -sh dist/*.app
```
