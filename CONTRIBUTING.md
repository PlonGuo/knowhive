# Contributing to KnowHive

## Development Setup

### Prerequisites

- Node.js 18+, pnpm (`npm install -g pnpm`)
- Python 3.11+, [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Ollama (optional — for local LLM testing)

### Install dependencies

```bash
# Frontend
pnpm install

# Backend
cd backend && uv sync
```

### Run in development mode

```bash
pnpm dev:all
```

This starts the FastAPI sidecar on port 18200, waits for it to be healthy, then launches Electron with Vite hot-reload.

## Running Tests

### Frontend + Electron (Vitest)

```bash
pnpm test
```

Tests live in `tests/src/` (React components) and `tests/electron/` (Electron main-process modules).

### Backend (pytest)

```bash
cd backend
uv run pytest
```

Run a specific file:

```bash
uv run pytest tests/test_knowledge.py -v
```

### Type checking

```bash
pnpm type-check        # frontend TypeScript
cd backend && uv run mypy app  # backend (if mypy is configured)
```

## Code Style

- **Frontend**: TypeScript strict mode; Tailwind CSS for styling; shadcn/ui components where appropriate
- **Backend**: Python type hints throughout; Pydantic v2 models for all request/response schemas
- **Tests**: TDD — write tests before implementation; all new features require passing tests

## Architecture Notes

- **IPC**: Electron ↔ React communication uses `contextBridge` in `electron/preload.ts`. Add new IPC channels there and in `electron/main.ts`.
- **Backend routers**: Each feature area has its own router in `backend/app/routers/`. Register it in `main.py` lifespan.
- **Services**: Business logic lives in `backend/app/services/`. Routers are thin; services hold state and do the work.
- **Data paths**: All data paths (SQLite, ChromaDB, knowledge dir) are derived from `--data-dir` passed to the sidecar. Never hardcode paths.

## Submitting Changes

1. Fork the repo and create a feature branch
2. Write tests first (TDD)
3. Make your implementation pass the tests
4. Verify: `pnpm test` and `cd backend && uv run pytest`
5. Open a pull request with a clear description of what and why

## Reporting Issues

Please open a GitHub issue with:
- Your OS and architecture
- KnowHive version
- Steps to reproduce
- Relevant logs (`logs/backend.log`, `logs/electron.log`)
