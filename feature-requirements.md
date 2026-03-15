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

### 1E. Packaging (REVISED — system Python, no bundling)

- [x] Task 15: Configure `electron-builder.yml` — macOS target (.dmg + .app), hardened runtime, no extraResources for Python — verified by: valid YAML, `pnpm build:dry` passes
- [—] Task 16: OBSOLETE — no longer bundling Python; users install Python + uv themselves
- [x] Task 17: Sidecar uses system `uv` to run FastAPI in both dev and packaged mode — verified by: `pnpm dev:all` launches sidecar successfully

---

## Phase 2: Core RAG (MVP)

### 2A. Backend Infrastructure

- [ ] Task 18: Add RAG dependencies — add langchain-core, langchain-community, langchain-text-splitters, chromadb, sentence-transformers, aiosqlite to pyproject.toml; `uv sync` — verified by: `cd backend && uv run python -c "import langchain_core, chromadb, sentence_transformers; print('ok')"`
- [ ] Task 19: SQLite database setup — implement `app/database.py` with async SQLite connection manager, create `documents`, `chat_messages`, `ingest_tasks` tables per PRD schema; `app/models.py` with Pydantic models — verified by: `cd backend && uv run pytest tests/test_database.py -v` passes
- [ ] Task 20: Config system — implement `app/config.py` to read/write `config.yaml` (LLM provider, model name, base URL, API key, embedding language); add `GET /config`, `PUT /config`, `POST /config/test-llm` endpoints — verified by: `cd backend && uv run pytest tests/test_config.py -v` passes

### 2B. Ingest Pipeline

- [ ] Task 21: Ingest service — implement `app/services/ingest_service.py`: load Markdown files, split with RecursiveCharacterTextSplitter (chunk_size=1000, overlap=200), embed with sentence-transformers, store in Chroma with metadata (file_path, chunk_index); deduplicate by file_path — verified by: `cd backend && uv run pytest tests/test_ingest_service.py -v` passes
- [ ] Task 22: Ingest API endpoints — implement `app/routers/ingest.py`: `POST /ingest/files` (accept file paths, return task_id), `GET /ingest/status/{id}` (progress), `POST /ingest/resync` (manual sync trigger) — verified by: `cd backend && uv run pytest tests/test_ingest_api.py -v` passes

### 2C. Knowledge & Chat

- [ ] Task 23: Knowledge API — implement `app/routers/knowledge.py`: `GET /knowledge/tree` (file tree JSON), `GET /knowledge/file?path=` (file content read-only) — verified by: `cd backend && uv run pytest tests/test_knowledge_api.py -v` passes
- [ ] Task 24: RAG query service — implement `app/services/rag_service.py`: Chroma top-k retrieval (default k=5), prompt assembly (system prompt + context + user question), LLM call via langchain ChatModel (Ollama or OpenAI-compatible) — verified by: `cd backend && uv run pytest tests/test_rag_service.py -v` passes
- [ ] Task 25: Chat API with SSE streaming — implement `app/routers/chat.py`: `POST /chat` (SSE stream with token/sources/done events), `GET /chat/history` (with limit/offset), `DELETE /chat/history` — verified by: `cd backend && uv run pytest tests/test_chat_api.py -v` passes
- [ ] Task 26: Startup sync — implement `app/services/sync_service.py`: on startup scan knowledge/ dir, compare with SQLite (new → embed, modified → re-embed, deleted → remove vectors + DB records) — verified by: `cd backend && uv run pytest tests/test_sync_service.py -v` passes

### 2D. React Frontend

- [ ] Task 27: App layout shell — implement main layout with sidebar (left), chat area (center), status bar (bottom) using shadcn/ui + Tailwind; responsive split pane — verified by: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean
- [ ] Task 28: Settings page — implement settings UI: LLM provider selector, model name, base URL, API key (conditional), embedding language, test connection button; calls `GET/PUT /config` and `POST /config/test-llm` — verified by: `pnpm vitest run` passes
- [ ] Task 29: File tree sidebar — implement knowledge file tree component: fetches `GET /knowledge/tree`, displays collapsible tree, click opens read-only preview; import button triggers file/folder picker via IPC — verified by: `pnpm vitest run` passes
- [ ] Task 30: Chat interface — implement chat UI: message list with Markdown rendering, chat input (Enter send, Shift+Enter newline), SSE streaming display, source file citations; calls `POST /chat`, `GET/DELETE /chat/history` — verified by: `pnpm vitest run` passes
- [ ] Task 31: Import flow — implement import UI: file/folder picker dialog (via Electron IPC), call `POST /ingest/files`, show progress bar, refresh file tree on completion — verified by: `pnpm vitest run` passes

### 2E. Integration

- [ ] Task 32: End-to-end wiring — connect frontend to all backend APIs via IPC bridge; update preload.ts and main.ts with new IPC channels; startup sync on app launch — verified by: `pnpm dev:all` launches, settings page works, file import works, chat returns RAG responses (manual)

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
```

---

## Phase 6: LangChain + LangGraph Migration

### 6A. LangChain ChatModel Integration

- [ ] Task 89: Add LangChain provider deps — add `langchain-ollama>=0.3.0`, `langchain-openai>=0.3.0`, `langchain-anthropic>=0.3.0`, `langgraph>=0.4.0` to `backend/pyproject.toml`; `uv sync` — verified by: `cd backend && uv run python -c "from langchain_ollama import ChatOllama; from langchain_openai import ChatOpenAI; from langchain_anthropic import ChatAnthropic; from langgraph.graph import StateGraph; print('ok')"`
- [ ] Task 90: LLM factory — create `backend/app/services/llm_factory.py` with `create_chat_model(config: AppConfig) -> BaseChatModel` (Ollama→ChatOllama, OpenAI→ChatOpenAI, Anthropic→ChatAnthropic) and `dicts_to_messages()` helper — verified by: `cd backend && uv run pytest tests/test_llm_factory.py -v` passes
- [ ] Task 91: Refactor RAGService LLM calls — replace httpx `call_llm()` and `call_llm_stream()` with LangChain `model.ainvoke()` / `model.astream()` via `create_chat_model()`; remove `import httpx` and `_prepare_anthropic()`; keep method signatures identical — verified by: `cd backend && uv run pytest tests/test_rag_service.py -v` passes
- [ ] Task 92: Update RAG service tests — rewrite `test_rag_service.py` LLM mocks from `httpx.AsyncClient` patches to `create_chat_model` patches with `AIMessage`/`AIMessageChunk` returns; remove Anthropic header/body tests — verified by: `cd backend && uv run pytest tests/test_rag_service.py -v` all 28 tests pass
- [ ] Task 93: Verify downstream callers — run full test suite to confirm `chat_api`, `summary_service`, `eval_ragas` tests still pass with unchanged signatures — verified by: `cd backend && uv run pytest` all 320+ tests pass

### 6B. LangGraph StateGraph

- [ ] Task 94: RAG graph — create `backend/app/services/rag_graph.py` with `RAGState` TypedDict and `build_rag_graph(rag_service)` returning `CompiledGraph` (nodes: retrieve → build_prompt → END) — verified by: `cd backend && uv run pytest tests/test_rag_graph.py -v` passes
- [ ] Task 95: Wire graph into chat router — update `backend/app/routers/chat.py` `_chat_stream()` to use `graph.ainvoke()` for retrieval+prompt, then `model.astream()` for token streaming; SSE events unchanged — verified by: `cd backend && uv run pytest tests/test_chat_api.py -v` passes
- [ ] Task 96: Replace Langfuse manual tracing — replace manual span creation in `RAGService.query()` with LangChain `CallbackHandler` from langfuse; keep env-var gating — verified by: `cd backend && uv run pytest tests/test_rag_service.py -v` passes
- [ ] Task 97: Full integration verification — run all backend + frontend tests; manual smoke test POST /chat with SSE — verified by: `cd backend && uv run pytest` all pass + `cd .. && pnpm vitest run` all pass
