# HANDOFF — KnowHive 后端 TS/bun 迁移(交接给新 session)

> 单一入口文档。新 session 开场先读这个 + `git log --oneline -20` + `~/.claude/plans/obsidian-markdown-obsidian-cli-streamed-widget.md`(完整 roadmap)+ `learnings/`(决策依据)。

## 现在在哪(2026-07-02)

从 **Electron + Python 后端** 迁移到 **Tauri 壳 + TS/bun sidecar**。项目定位:**学习/作品集/面试**(不是产品),所以全栈重写是为了学习价值,不是用户价值。

- ✅ **Phase A/B/C 完成**:壳 spawn bun sidecar、bun:sqlite+FTS5、cosine KNN + RRF 混合检索、Ollama embedding、ingest、`/chat` 流式(AI SDK v7)、前端 `useChat`、**WKWebView 流式真机验证流畅**。
- ✅ **RAGAS 验证通过**:TS 无rerank(0.669/0.687/0.835/0.706)全面优于 Python 无rerank 基线,检索指标追平 Python 有rerank 基线(hybrid 的功劳)。**迁移无退化。**
- 👉 **下一步:Phase D** —— 移植其余服务(knowledge/config/import 进度/watcher/review/export)让 app 完整可用,**并入 R3**(onboarding 重做:云端 vs 本地模型选择 + Ollama 检测/自动 pull)。

## 架构 & 关键文件

```
Tauri 壳 (Rust, src-tauri/) — spawn/守护 bun sidecar
  src-tauri/src/sidecar.rs   spawn `bun run src/index.ts`(原 uv/python)
  src-tauri/src/lib.rs        resolve_server_dir → server/;commands.rs check_setup(仍探 uv,待改)
server/ (bun + Hono)         主后端 sidecar
  src/index.ts               /health /setup/status /ingest/files /search /chat(+ CORS)
  src/db.ts                  bun:sqlite + FTS5 + 触发器;openDb/openDbAt
  src/retrieval.ts           cosine KNN + VectorIndex 接缝(BruteForceIndex;可换 ANN)
  src/store.ts               入库 + hybridSearch(向量 ⊕ FTS5,RRF)
  src/embed.ts               Ollama /api/embed(english→nomic-embed / mixed→bge-m3)
  src/ingest.ts src/chunker.ts src/frontmatter.ts src/rag.ts src/hybrid.ts
  *.test.ts                  35 bun 测试(`bun test`)
shared/schema.ts             前后端共用 Zod(AppConfig,对齐 backend/app/config.py)
src/components/layout/ChatArea.tsx   前端 useChat(v7)
src/lib/platform.ts          getBackendUrl 等(Electron/Tauri 双栈适配)
backend/ (Python)            仅剩 dev/CI 的 RAGAS eval,不打包
  app/eval_ragas_ts.py       打 TS /search+/chat 跑 RAGAS;eval_results/{python_,ts_}_*.json
```

## 怎么跑(重要)

```
cd /Users/plonguo/Git/knowhive
pnpm tauri:dev          # 新终端(新终端才有 cargo,已写进 ~/.zshrc)
```
前提:**Ollama 在跑**,且已装 `llama3.2`(chat)、`nomic-embed-text`、`bge-m3`(embedding)。
- server 单独跑/测:`bun run server/src/index.ts --port <p> --data-dir <d>` / `bun test --cwd server`
- **根目录仍用 pnpm**(前端/Tauri 编排);**bun 只管 server sidecar**。切根目录 bun 排在 Phase F(要先删 Electron,否则 bun+electron 冲突)。

## 操作性 gotcha(不看会踩)

1. **Tauri app_data_dir** = `~/Library/Application Support/com.plonguo.knowhive/`。已放 `config.yaml`(`first_run_complete:true` + `embedding_language:mixed`)跳过**还没移植的旧 onboarding**(否则 App.tsx 会显示调 Python 端点的 onboarding,卡住)。若改了 db schema,删该目录下 `knowhive.db*` 让其重建(`CREATE TABLE IF NOT EXISTS` 不补列)。
2. **CORS**:sidecar 必须 `app.use('*', cors())`(WKWebView→sidecar 跨域)。已加。
3. **AI SDK v7 + bun**:provider 需 `zod/v4` 子路径 → server **本地装了 zod@4**;从 `/tmp` 跑 spike 会落到 bun 全局缓存解析失败,**要在 server 目录内跑**。`convertToModelMessages` 在 v7 返回 `{}` → 已改为手动 `UIMessage→{role,content}` 映射(index.ts)。
4. **sqlite-vec**:macOS 系统 SQLite 禁扩展加载 → db.ts 用 Homebrew libsqlite3(`setCustomSQLite`),加载设为非致命。**当前向量检索用暴力 KNN(不依赖 sqlite-vec)**。
5. **RAGAS eval**:从 `backend/` 跑,需 `set -a; source ../.env; set +a`(OPENAI_API_KEY,已在根 `.env`,gitignored);TS sidecar 要先起在 `--base` 端口。语料 = `docs/leetcode/刷题知识库/`。

## 已工作 / 还坏(Phase D 目标)
- ✅ 聊天(流式+sources)、导入(/ingest/files)、检索
- ❌ 知识树列表、设置保存、watcher、review、overview、export、onboarding —— 端点(/knowledge /config /watcher 等)还没从 Python 移到 TS

## Roadmap
主线:Phase D → E(rerank:LLM-as-reranker 或 transformers.js spike)→ F(bun build --compile + 打包 + 清 Python/Electron + 根目录切 bun)。
新想法(plan 文件详):R1 Tracing(Langfuse+Phoenix)、R2 prompt cache、R3 模型选择+Ollama自动pull(并入D)、R4 markdown 质量门+AI润色+elbow阈值实验。
