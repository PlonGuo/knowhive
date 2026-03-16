# KnowHive

A **local-first AI knowledge base** desktop app. Import your Markdown and PDF files, chat with them using any LLM (Ollama, OpenAI, or Anthropic Claude), and build a spaced-repetition review practice — all without your data leaving your machine.

<p align="center">
  <img src="build/icon.png" alt="KnowHive" width="128" />
</p>

## Highlights

- **Multi-Strategy RAG Pipeline** — LangGraph-orchestrated retrieval with dynamic query routing (HyDE / multi-query / direct), heading-aware chunking, and CrossEncoder reranking
- **Layered Conversation Memory** — Watermark-based compression preserves recent messages verbatim while summarizing older context, with LLM-powered query rewriting for multi-turn resolution
- **Process-Isolated Sidecar Architecture** — Electron + FastAPI with crash recovery and health-polling, enabling zero-downtime model switching across LLM backends
- **100% Local by Default** — All data stays on your machine; cloud LLMs are opt-in

## Features

| Feature | Description |
|---------|-------------|
| **RAG Chat** | Ask questions about your knowledge base with source citations and SSE streaming |
| **File Management** | Import `.md` and `.pdf` files; rename, delete, and edit Markdown in-app |
| **File Watcher** | Automatically re-indexes files when they change on disk |
| **Spaced Repetition** | SM-2 algorithm with AI-generated summaries for review scheduling |
| **Knowledge Overview** | Browse all documents with on-demand AI summaries |
| **Community Packs** | Import curated knowledge packs from the community manifest |
| **Embedding Models** | Download and switch sentence-transformer models (English / Chinese / Mixed) |
| **Data Export** | Export your full knowledge base + chat history as a ZIP |
| **Multi-Provider LLM** | Ollama, any OpenAI-compatible endpoint, or Anthropic Claude |
| **Custom System Prompt** | Tailor the AI assistant's behavior to your use case |
| **Onboarding Wizard** | First-run setup to check dependencies and configure your LLM |

## Architecture

```
┌─────────────────────────────────────────────┐
│            Electron Desktop Shell            │
│  ┌───────────────────────────────────────┐   │
│  │   React 18 + TypeScript + Tailwind    │   │
│  │   (Chat, Knowledge, Review, Settings) │   │
│  └──────────────────┬────────────────────┘   │
│                HTTP / SSE                     │
├─────────────────────┴───────────────────────┤
│           FastAPI Sidecar (Python)           │
│  ┌────────────┐  ┌────────────────────────┐  │
│  │  Routers   │  │       Services         │  │
│  │ chat       │  │ RAG (LangGraph)        │  │
│  │ config     │  │ Ingest + Chunking      │  │
│  │ ingest     │  │ Embedding + Reranking  │  │
│  │ knowledge  │  │ Memory Compression     │  │
│  │ review     │  │ Strategy Classifier    │  │
│  │ community  │  │ Spaced Repetition      │  │
│  │ export     │  │ LLM Factory            │  │
│  └────────────┘  └────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │  ChromaDB (vectors) + SQLite (metadata) │  │
│  └────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────┘
                  HTTP API
┌──────────────────────┴──────────────────────┐
│     Ollama  /  OpenAI-compatible  /  Claude  │
└──────────────────────────────────────────────┘
```

### RAG Pipeline (LangGraph)

The retrieval pipeline is orchestrated as a LangGraph `StateGraph` with conditional routing:

```
Query → [Rewrite (if memory enabled)]
           ↓
      [Route Pre-Retrieval]
       ├─ HyDE: generate hypothetical passage → embed → retrieve
       ├─ Multi-Query: expand to 3-5 variants → retrieve per variant → deduplicate
       └─ Direct: standard semantic search
           ↓
      [Retrieve from ChromaDB]
           ↓
      [Rerank (CrossEncoder, optional)]
           ↓
      [Build Prompt + Generate (SSE stream)]
```

**Strategy classifier** selects the pre-retrieval approach per query — either via rule-based heuristics or LLM-based intent classification.

### Conversation Memory

| Layer | Behavior |
|-------|----------|
| **Short-term** | Last N messages stored verbatim in SQLite |
| **Long-term** | Older messages compressed via LLM summarization |
| **Watermark** | Tracks compression boundary — avoids redundant re-summarization |
| **Query Rewriting** | LLM rewrites follow-up questions using conversation context |

### Sidecar Process Management

The `SidecarManager` in Electron handles the FastAPI backend lifecycle:

- **Dynamic port selection** — finds a free port at startup
- **Health polling** — GET `/health` every 200ms until ready (15s timeout)
- **Auto-restart** — up to 3 restart attempts on crash
- **Graceful shutdown** — SIGTERM → 2s grace period → force kill

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Electron 28 |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| Backend | FastAPI + Python 3.11+ |
| RAG orchestration | LangGraph (StateGraph) |
| LLM integrations | LangChain (Ollama, OpenAI, Anthropic) |
| Vector store | ChromaDB |
| Embeddings | sentence-transformers (local) |
| Reranker | CrossEncoder (local) |
| Database | SQLite (aiosqlite) |
| File parsing | Heading-aware Markdown splitter + PyMuPDF (PDF) |
| File watching | watchdog |
| Evaluation | RAGAS framework |
| Package managers | pnpm (frontend) + uv (backend) |

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js 18+ | Electron/React frontend |
| pnpm | `npm install -g pnpm` |
| Python 3.11+ | FastAPI sidecar |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | Python package manager |
| [Ollama](https://ollama.com/) *(optional)* | Local LLM runner; or use OpenAI / Anthropic |

## Installation

```bash
git clone https://github.com/PlonGuo/knowhive.git
cd knowhive

# Install frontend dependencies
pnpm install

# Install backend dependencies
cd backend && uv sync && cd ..
```

## Development

Run all three processes (backend + Vite + Electron) in one command:

```bash
pnpm dev:all
```

Or start them separately:

```bash
# Terminal 1 — FastAPI backend
cd backend
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 18200

# Terminal 2 — Electron + Vite (after backend is up)
BACKEND_URL=http://127.0.0.1:18200 pnpm dev
```

## Testing

```bash
# Frontend + Electron tests (Vitest)
pnpm test

# Backend tests (pytest)
cd backend
uv run pytest
```

### RAG Evaluation (RAGAS)

```bash
cd backend
uv run python -m app.eval_ragas
```

Evaluates the RAG pipeline against `eval_dataset.json` using RAGAS metrics: faithfulness, answer relevancy, context precision, and context recall.

## Building

```bash
# macOS (arm64 + x64 universal DMG)
pnpm build:mac

# Windows
pnpm build:win
```

## Project Structure

```
knowhive/
├── src/                      # React frontend (TypeScript)
│   └── components/
│       ├── layout/           # AppLayout, Sidebar, ChatArea, StatusBar
│       ├── knowledge/        # FileTree, MarkdownEditor, KnowledgeOverview
│       ├── settings/         # SettingsPage (LLM config, RAG options)
│       ├── review/           # ReviewPage (spaced repetition)
│       ├── community/        # CommunityBrowser
│       └── onboarding/       # OnboardingPage (first-run wizard)
├── electron/                 # Electron main process
│   ├── main.ts               # BrowserWindow, IPC handlers
│   ├── sidecar.ts            # FastAPI process lifecycle manager
│   └── preload.ts            # contextBridge API
├── backend/                  # FastAPI sidecar (Python)
│   └── app/
│       ├── main.py           # App factory, lifespan, service wiring
│       ├── routers/          # API endpoints (chat, config, ingest, ...)
│       └── services/         # Core logic
│           ├── rag_graph.py              # LangGraph RAG pipeline
│           ├── rag_service.py            # ChromaDB retrieval + prompt assembly
│           ├── llm_factory.py            # Multi-provider LLM instantiation
│           ├── hyde_service.py           # HyDE pre-retrieval strategy
│           ├── multi_query_service.py    # Multi-query expansion
│           ├── strategy_classifier.py    # Query intent → strategy routing
│           ├── query_rewriter.py         # Context-aware query rewriting
│           ├── memory_compression_service.py  # Layered memory compression
│           ├── reranker_service.py       # CrossEncoder reranking
│           ├── heading_chunker.py        # Heading-aware Markdown splitting
│           ├── ingest_service.py         # File import + embedding pipeline
│           ├── embedding_service.py      # sentence-transformer management
│           └── spaced_repetition_service.py   # SM-2 algorithm
└── tests/                    # Vitest (frontend) + pytest (backend)
```

## Configuration

All settings are managed through the in-app Settings page or `config.yaml`:

```yaml
llm_provider: openai-compatible   # ollama | openai-compatible | anthropic
model_name: gpt-4o-mini
base_url: https://api.openai.com/v1
embedding_language: english        # english | chinese | mixed
pre_retrieval_strategy: none       # none | hyde | multi_query | auto | auto_llm
use_reranker: false
chat_memory_turns: 0               # 0 = disabled
memory_compression_threshold: 20
custom_system_prompt: ''
```

## License

MIT
