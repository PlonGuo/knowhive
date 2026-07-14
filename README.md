# KnowHive

A **local-first AI knowledge base** desktop app. Import your Markdown notes, chat with them using any LLM (Ollama, OpenAI-compatible, or Anthropic Claude), and build a spaced-repetition review practice — all without your data leaving your machine.

## Highlights

- **Hybrid retrieval + in-process reranking** — vector KNN ⊕ SQLite FTS5 fused with Reciprocal Rank Fusion, then reranked by a cross-encoder (`bge-reranker-v2-m3`, int8 ONNX) running **inside the bun sidecar** via transformers.js — no Python, no external reranker service. An LLM-as-reranker backend is kept as a zero-dependency fallback.
- **RAGAS-validated migration** — the entire backend was ported from Python/FastAPI to TypeScript/bun with a RAGAS quality gate at every phase; the final stack beats the original Python baseline on all four metrics (faithfulness 0.749, answer relevancy 0.808, context precision 0.914, context recall 0.780).
- **Small, honest desktop bundle** — Tauri v2 shell (Rust) + bun sidecar: **126MB .app / 43MB dmg**. The 571MB reranker model is downloaded on demand into the app data dir, never shipped in the installer.
- **100% local by default** — Ollama for chat and embeddings; cloud LLMs are opt-in.

## Features

| Feature | Description |
|---------|-------------|
| **RAG Chat** | Ask questions about your knowledge base with source citations and token streaming (Vercel AI SDK v7) |
| **Agent Mode (opt-in)** | A self-built tool-use loop: the model can search and read notes on its own for multi-hop questions, with live tool activity in the chat UI |
| **File Management** | Import `.md` files; rename, delete, and edit Markdown in-app with automatic re-indexing |
| **File Watcher** | Files edited outside the app (e.g. in Obsidian) are re-indexed automatically |
| **Spaced Repetition** | SM-2 algorithm with AI-generated summaries for review scheduling |
| **Knowledge Overview** | Browse all documents with on-demand, cached AI summaries |
| **Reranker Control** | Toggle reranking; switch between in-process cross-encoder and LLM-as-reranker backends |
| **Embedding Models** | English (`nomic-embed-text`) / Chinese / Mixed (`bge-m3`) via Ollama, with background re-embedding on switch |
| **Data Export** | Export your full knowledge base + config as a ZIP |
| **Multi-Provider LLM** | Ollama, any OpenAI-compatible endpoint, or Anthropic Claude |
| **Onboarding Wizard** | First-run setup: local Ollama (with model download progress) or cloud API |

> Not (yet) included: PDF ingestion, persistent chat history / conversation memory (a full layered-memory system is designed and queued), community knowledge packs.

## Architecture

```
┌───────────────────────────────────────────────┐
│           Tauri v2 Shell (Rust)               │
│  ┌─────────────────────────────────────────┐  │
│  │    React 18 + TypeScript + Tailwind     │  │
│  │   (Chat, Knowledge, Review, Settings)   │  │
│  └───────────────────┬─────────────────────┘  │
│               HTTP / streaming                │
├────────────────────── ┴ ──────────────────────┤
│           bun Sidecar (TypeScript)            │
│  ┌────────────┐  ┌─────────────────────────┐  │
│  │ Hono routes│  │        Services         │  │
│  │ chat       │  │ Hybrid retrieval (RRF)  │  │
│  │ config     │  │ Cross-encoder reranker  │  │
│  │ ingest     │  │ Ingest + chunking       │  │
│  │ knowledge  │  │ Watcher + sync          │  │
│  │ review     │  │ SM-2 spaced repetition  │  │
│  │ ollama     │  │ Summaries + export      │  │
│  └────────────┘  └─────────────────────────┘  │
│  ┌─────────────────────────────────────────┐  │
│  │   bun:sqlite — chunks + vectors + FTS5  │  │
│  └─────────────────────────────────────────┘  │
└────────────────────── ┬ ──────────────────────┘
                    HTTP API
┌────────────────────── ┴ ──────────────────────┐
│     Ollama  /  OpenAI-compatible  /  Claude   │
└───────────────────────────────────────────────┘
```

The Rust shell finds a free port (18200–18300), spawns the sidecar, polls `/health` until ready, restarts it on crash (up to 3 attempts), and stops it on exit. The sidecar also self-terminates if it ever finds itself orphaned. In dev the sidecar runs from source with the system `bun`; in the packaged app a bundled bun runtime executes a pre-bundled `index.js` from the app resources.

### RAG Pipeline

```
Query → embed (Ollama) → hybrid retrieve (vector KNN ⊕ FTS5, RRF-fused, top 20)
      → rerank to top 5
          ├─ cross-encoder (default): bge-reranker-v2-m3 int8 ONNX, in-process, ~50ms/pair
          └─ llm (fallback): listwise coverage-prompt rerank with the configured chat model
      → system prompt injection → streamText → UI-message stream with source metadata
```

Reranking fails open: any scorer error falls back to hybrid order. Retrieval design choices (candidate count, k, coverage vs relevance prompt) were selected by a k-sweep experiment — see [learnings/Reranker-K-Sweep.md](learnings/Reranker-K-Sweep.md).

### Agent Mode (tool-use loop)

`chat_mode: agentic` upgrades the pipeline to a self-built agent loop (no framework — AI SDK v7 primitives): the same pre-retrieval runs first (so a model that never calls tools degrades to single-pass, not zero context), then the model can call `search_knowledge` / `read_note` / `list_notes` for follow-up hops, capped at 6 steps with a tools-stripped final step that structurally guarantees a text answer. Tool failures return error values instead of throwing, sources aggregate across steps, and the chat UI streams tool activity live.

It ships **off by default** — a pre-registered eval gate (single vs agentic, 4 arms, RAGAS + a deterministic `source_recall` metric) showed that with a local 3B model the loop's retrieval gains don't survive answer synthesis. The write-up, including why that negative result is the interesting part, is in [learnings/Agentic-vs-SingleShot.md](learnings/Agentic-vs-SingleShot.md).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Sidecar runtime | bun + Hono |
| LLM integration | Vercel AI SDK v7 (streamText / useChat) |
| Storage & search | bun:sqlite — one DB for chunks, brute-force cosine KNN, FTS5 |
| Embeddings | Ollama (`nomic-embed-text` / `bge-m3`) |
| Reranker | `onnx-community/bge-reranker-v2-m3-ONNX` int8 via @huggingface/transformers (onnxruntime-node) |
| Evaluation | RAGAS (Python harness in `backend/`, dev-only) |
| Package manager | bun (root + `server/`) |

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| [bun](https://bun.sh/) | Runtime + package manager for everything JS/TS |
| [Rust toolchain](https://rustup.rs/) | Tauri shell (`cargo` must be on PATH) |
| [Ollama](https://ollama.com/) | Local LLM runner with `llama3.2`, `nomic-embed-text`, `bge-m3` pulled — or configure a cloud provider in onboarding |

## Development

```bash
git clone https://github.com/PlonGuo/knowhive.git
cd knowhive
bun install
cd server && bun install && cd ..

bun run tauri:dev        # Tauri shell + vite + sidecar, all wired
```

The sidecar can also run standalone (useful for API work and evals):

```bash
bun run server/src/index.ts --port 18200 --data-dir /tmp/knowhive-dev
```

## Testing

```bash
bun run test             # frontend (vitest — note: `bun run test`, not `bun test`)
cd server && bun test    # sidecar (must run from server/, not the repo root)
cd src-tauri && cargo test
```

### RAG Evaluation (RAGAS)

The Python code under `backend/` is retained only as the RAGAS eval harness (it needs the ragas/langchain ecosystem); it is not part of the app:

```bash
cd backend
uv run python -m app.eval_ragas_ts   # evaluates the running TS sidecar
```

Metrics: faithfulness, answer relevancy, context precision, context recall. Full methodology and phase-by-phase results: [learnings/Stack-Migration-and-RAGAS-Validation.md](learnings/Stack-Migration-and-RAGAS-Validation.md).

## Building

```bash
bun run tauri:build      # → src-tauri/target/release/bundle/{macos/KnowHive.app, dmg/}
```

The build bundles three pieces (see [server/build-dist.ts](server/build-dist.ts)):

1. `resources/server/index.js` — the sidecar bundled to a single JS file, with native packages left external
2. `resources/server/node_modules` — a real, minimal install of just the native packages (onnxruntime dylibs must live on disk), trimmed to the host platform
3. `binaries/bun-<triple>` — the bun runtime itself, shipped as a Tauri externalBin

Why not a single `bun build --compile` binary? It works — we spiked it — but native `.node` addons and their dylibs make it fragile. The trade-off analysis and revert triggers are documented in [learnings/Bun-Compile-Native-Deps-Spike.md](learnings/Bun-Compile-Native-Deps-Spike.md).

## Project Structure

```
knowhive/
├── src/                      # React frontend (TypeScript)
│   ├── components/
│   │   ├── layout/           # AppLayout, Sidebar, ChatArea, StatusBar
│   │   ├── knowledge/        # FileTree, MarkdownEditor, KnowledgeOverview
│   │   ├── settings/         # SettingsPage (LLM config, RAG options)
│   │   ├── review/           # ReviewPage (spaced repetition)
│   │   └── onboarding/       # OnboardingPage (first-run wizard)
│   └── lib/                  # platform adapter (Tauri/browser), Ollama client
├── src-tauri/                # Tauri shell (Rust)
│   ├── src/sidecar.rs        # sidecar lifecycle: spawn, health, restart, stop
│   └── tauri.conf.json       # bundling: externalBin bun + server resources
├── server/                   # bun sidecar (TypeScript + Hono)
│   ├── src/index.ts          # assembly: routes wired with injected deps
│   ├── src/db.ts             # bun:sqlite + FTS5 + triggers
│   ├── src/store.ts          # hybrid search (vector ⊕ FTS5, RRF)
│   ├── src/crossEncoder*.ts  # in-process ONNX reranker (Phase E2)
│   ├── src/rerank.ts         # LLM-as-reranker (Phase E1, fallback)
│   ├── src/*Routes.ts        # Hono sub-routes (dependency-injected, unit-tested)
│   └── build-dist.ts         # packaged-app dist builder
├── shared/schema.ts          # Zod config contract shared by frontend + sidecar
├── backend/                  # Python — RAGAS eval harness only (not shipped)
├── learnings/                # decision records: RAGAS runs, k-sweep, packaging spike
└── tests/                    # vitest (frontend)
```

## Configuration

All settings are managed through the in-app Settings page or `config.yaml` in the app data dir (`~/Library/Application Support/com.plonguo.knowhive/` on macOS):

```yaml
llm_provider: ollama              # ollama | openai-compatible | anthropic
model_name: llama3.2
base_url: http://localhost:11434
embedding_language: english       # english | chinese | mixed
use_reranker: false
reranker_backend: cross-encoder   # cross-encoder | llm
chat_mode: single                 # single | agentic (tool-use loop)
custom_system_prompt: ''
```

## License

MIT
