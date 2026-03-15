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

---

## Phase 7: Knowledge Base Template + Advanced RAG

### 7A. Frontmatter + Template Schema

- [ ] Task 98: Frontmatter parser — create `backend/app/services/frontmatter_parser.py` with `FrontmatterData` dataclass and `parse_frontmatter(text) -> tuple[FrontmatterData, str]`; handles valid frontmatter, missing frontmatter, empty frontmatter, malformed YAML — verified by: `cd backend && uv run pytest tests/test_frontmatter_parser.py -v` passes
- [ ] Task 99: SQLite schema migration — add `title`, `category`, `tags`, `difficulty`, `pack_id` columns to documents table in `database.py`; migration-safe (check column existence before ALTER) — verified by: `cd backend && uv run pytest tests/test_database.py -v` passes
- [ ] Task 100: Wire frontmatter into IngestService — in `ingest_file()`, parse frontmatter before chunking, pass body (without frontmatter) to splitter, store frontmatter fields in SQLite documents table, add `pack_id` to Chroma chunk metadata — verified by: `cd backend && uv run pytest tests/test_ingest_service.py -v` passes

### 7B. Heading-Aware Chunking

- [ ] Task 101: Heading chunker — create `backend/app/services/heading_chunker.py` with `split_by_headings(text, metadata) -> list[Document]`; splits by `##` headings, sub-splits long sections (>1500 chars), merges short sections (<100 chars), adds `section_heading` + `chunk_index` metadata — verified by: `cd backend && uv run pytest tests/test_heading_chunker.py -v` passes
- [ ] Task 102: Wire heading chunker into IngestService — `.md` files use `split_by_headings()`, `.pdf` files keep `split_text()`; `section_heading` added to Chroma metadata; update existing ingest tests — verified by: `cd backend && uv run pytest tests/test_ingest_service.py -v` passes

### 7C. HyDE Pre-Retrieval

- [ ] Task 103: HyDE service — create `backend/app/services/hyde_service.py` with `generate_hypothetical_doc(question, config) -> str`; uses `create_chat_model()` to generate hypothetical document passage — verified by: `cd backend && uv run pytest tests/test_hyde_service.py -v` passes
- [ ] Task 104: Add HyDE to RAG graph — add `hyde_query` and `use_hyde` to `RAGState`; add `hyde` node before `retrieve` in `create_rag_prep_graph()`; retrieve uses `hyde_query` for Chroma search, keeps original `question` for prompt; add `use_hyde` to `AppConfig` — verified by: `cd backend && uv run pytest tests/test_rag_graph.py -v` passes
- [ ] Task 105: Update chat router for HyDE — pass `config.use_hyde` into graph state; update existing chat API tests — verified by: `cd backend && uv run pytest tests/test_chat_api.py -v` passes

### 7D. Metadata-Filtered Retrieval

- [ ] Task 106: Add metadata filter to RAGService.retrieve() — add optional `where: dict` parameter to `retrieve()` method, pass to `collection.query()`; backward compatible (None = no filter) — verified by: `cd backend && uv run pytest tests/test_rag_service.py -v` passes
- [ ] Task 107: Add pack_id filter to chat API — add optional `pack_id` field to `ChatRequest`; pass to graph state; retrieve node builds `where={"pack_id": ...}` filter — verified by: `cd backend && uv run pytest tests/test_chat_api.py -v` passes

### 7E. Sample Content + Eval

- [ ] Task 108: Sample knowledge pack — create `backend/tests/fixtures/sample_pack/` with 5-10 LeetCode-style `.md` files with frontmatter (title, category, tags, difficulty, pack_id); create `backend/tests/fixtures/eval_dataset.json` with 10-20 question/ground_truth pairs — verified by: files exist and are valid markdown/JSON
- [ ] Task 109: Ingest + eval integration test — write test that ingests sample_pack, runs queries, verifies frontmatter stored in SQLite, heading chunks have section_heading metadata, pack_id filter works — verified by: `cd backend && uv run pytest tests/test_advanced_rag_integration.py -v` passes

### 7F. Migration + Verification

- [ ] Task 110: Re-ingest migration — add `chunk_strategy` column to documents table; `POST /ingest/migrate` endpoint re-ingests all docs with heading-aware chunking; startup sync detects old strategy docs — verified by: `cd backend && uv run pytest tests/test_ingest_migration.py -v` passes
- [ ] Task 111: Full integration verification — run all backend + frontend tests; verify existing features unbroken — verified by: `cd backend && uv run pytest` all pass + `cd .. && pnpm vitest run` all pass

---

## Phase 8: LeetCode Basics Content Pack

### 8A. Template Guide + Algorithm Docs

- [ ] Task 112: Create `knowledge/TEMPLATE_GUIDE.md` (AI-agent-friendly template guide with instructions, schemas, 3 templates, tag vocabulary, complete examples) + create directory structure `knowledge/leetcode-basics/{algorithms,problems,companies}/` — verified by: TEMPLATE_GUIDE.md exists, directories created
- [ ] Task 113: Convert 6 algorithm docs (bfs, dfs, dijkstra, dynamic-programming, interval-dp, digit-dp) from `docs/leetcode/刷题知识库/Algorithms/` to standardized frontmatter format in `knowledge/leetcode-basics/algorithms/` — verified by: files exist with valid frontmatter, no `[[` wiki links, no emoji in headers
- [ ] Task 114: Convert 6 algorithm docs (rerooting-dp, two-pointer, greedy, heap-priority-queue, difference-array, graph-theory-overview) — verified by: same criteria as Task 113

### 8B. Problem Docs

- [ ] Task 115: Convert 6 problem docs (lc-0233, lc-0253, lc-0310, lc-0312, lc-0486, lc-0600) from `docs/leetcode/刷题知识库/Problems/` to `knowledge/leetcode-basics/problems/` — verified by: files exist with valid frontmatter, Python code blocks preserved, no wiki links
- [ ] Task 116: Convert 6 problem docs (lc-0732, lc-0834, lc-0877, lc-1245, lc-2385, lc-2719) — verified by: same criteria as Task 115

### 8C. Company Doc + Eval Dataset

- [ ] Task 117: Convert company doc (rippling.md) from `docs/leetcode/刷题知识库/Companies/` to `knowledge/leetcode-basics/companies/` — verified by: file exists with valid frontmatter
- [ ] Task 118: Create `backend/tests/fixtures/eval_dataset_leetcode.json` with 25-30 Q&A pairs grounded in pack content (algorithm concepts, problem solutions, cross-references) — verified by: valid JSON, all ground_truth answers match actual file content

### 8D. Verification

- [ ] Task 119: Ingest verification — write test that ingests `knowledge/leetcode-basics/`, verifies 25 files indexed, heading-aware chunking, pack_id filter, frontmatter in SQLite — verified by: `cd backend && uv run pytest tests/test_leetcode_pack_integration.py -v` passes
- [ ] Task 120: Full test suite + eval baseline — run all backend + frontend tests, run eval_ragas.py against leetcode pack — verified by: all tests pass, eval produces non-zero scores
