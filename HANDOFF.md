# HANDOFF — KnowHive 后端 TS/bun 迁移(交接给新 session)

> 单一入口文档。新 session 开场先读这个 + `git log --oneline -20` + `~/.claude/plans/obsidian-markdown-obsidian-cli-streamed-widget.md`(完整 roadmap)+ `learnings/`(决策依据)。

## 现在在哪(2026-07-02)

从 **Electron + Python 后端** 迁移到 **Tauri 壳 + TS/bun sidecar**。项目定位:**学习/作品集/面试**(不是产品),所以全栈重写是为了学习价值,不是用户价值。

- ✅ **Phase A/B/C 完成**:壳 spawn bun sidecar、bun:sqlite+FTS5、cosine KNN + RRF 混合检索、Ollama embedding、ingest、`/chat` 流式(AI SDK v7)、前端 `useChat`、**WKWebView 流式真机验证流畅**。
- ✅ **RAGAS 验证通过**:TS 无rerank 全面优于 Python 无rerank 基线,检索指标追平 Python 有rerank 基线。**迁移无退化。**
- ✅ **Phase D + R3 完成(本轮,D1–D8 共 8 个 commit)**:config / knowledge CRUD / ingest 任务进度 / watcher+sync / SM-2 review / summary / export / setup+ollama+onboarding 全部移植到 TS。**136 bun 测试绿**,每块都有真 Ollama e2e。前端 vitest 252 绿(仅剩 chat.test.tsx 9 个 Phase C 遗留失败,测的是旧 chat 组件,待重写)。
- 👉 **下一步:真机验证 `pnpm tauri:dev` 全流程**(onboarding 新流程 + pull 进度条在 WKWebView 上),然后 Phase E(reranker)或直接 F(打包)。

## Phase D 移植明细(全部带 TDD parity 测试 + e2e)

| 块 | TS 模块 | 端点 | 备注 |
|---|---|---|---|
| D1 config | configRoutes/testLlm | GET/PUT /config, POST /config/test-llm | PUT 热更运行时 config;语言切换→后台 re-embed |
| D2 knowledge | knowledge/knowledgeRoutes | /knowledge/tree, GET/PUT/DELETE /knowledge/file, PUT .../content | 编辑重嵌、重命名同步 chunks+documents、traversal 守卫 |
| D3 ingest | ingestTasks/ingestRoutes | POST /ingest/files, GET /ingest/status/:id, POST /ingest/resync | 任务后台跑(比 Python 强:进度条真实);/ingest/migrate 不移(Chroma 迁移已过时) |
| D4 watcher | watcher/sync/watcherRoutes | GET /watcher/status, POST /watcher/toggle | fs.watch+debounce+防重叠;启动 sync + 自动 start;ingest 现在存 file_hash |
| D5 review | sm2/reviewRoutes | /review/due /record /stats | SM-2 严格 parity(含 round-half-to-even) |
| D6 summary | summary/summaryRoutes | GET /summary/file, POST /summary/{cached,generate,batch} | 缓存优先;LLM 注入 |
| D7 export | export/exportRoutes | POST /export/{full,chat,file} | fflate zip(纯 JS);chat 历史暂为空(无状态) |
| D8 setup/R3 | setupRoutes/ollama/ollamaRoutes | GET /setup/status, POST /setup/complete, GET /ollama/status, POST /ollama/pull | pull 是 NDJSON 流式转发;/reranker/* 为 disabled stub(Phase E);/embedding/* 不移植(被 /ollama/* 取代) |

**R3 前端**:OnboardingPage 重做(选「本地 Ollama」vs「云端 API」→ 检测+一键 pull 带进度条→完成);SettingsPage embedding 区块走 /ollama/*;`src/lib/ollama.ts` 共享 NDJSON 解析。**chatModel() 按 llm_provider 分派**(ollama/openai-compatible/anthropic via @ai-sdk/anthropic)——云端路径没有 key 未实测。Rust `check_setup`(探 uv)已删(死代码,setup 判定全走后端)。

## 架构 & 关键文件

```
Tauri 壳 (Rust, src-tauri/) — spawn/守护 bun sidecar
  src-tauri/src/sidecar.rs   spawn `bun run src/index.ts`
  src-tauri/src/commands.rs  get_backend_url / get_sidecar_status(check_setup 已删)
server/ (bun + Hono)         主后端 sidecar
  src/index.ts               组装:所有 *Routes 工厂注入 db/config/embedder/LLM
  src/db.ts                  bun:sqlite + FTS5 + 触发器
  src/store.ts src/retrieval.ts src/hybrid.ts   向量 ⊕ FTS5,RRF
  src/embed.ts               Ollama /api/embed(english→nomic-embed / mixed→bge-m3)
  src/{config,knowledge,ingestTasks,sync,watcher,sm2,summary,export,ollama,testLlm}.ts   服务层(纯逻辑,TDD)
  src/*Routes.ts             Hono 子路由(依赖注入,离线可测)
  *.test.ts                  136 bun 测试(`cd server && bun test`)
shared/schema.ts             前后端共用 Zod(AppConfig)
src/lib/ollama.ts            前端共享 Ollama status/pull 客户端
src/components/onboarding/OnboardingPage.tsx   R3 新 onboarding
backend/ (Python)            仅剩 dev/CI 的 RAGAS eval,不打包
```

## 怎么跑(重要)

```
cd /Users/plonguo/Git/knowhive
pnpm tauri:dev          # 新终端(新终端才有 cargo,已写进 ~/.zshrc)
```
前提:**Ollama 在跑**,且已装 `llama3.2`、`nomic-embed-text`、`bge-m3`。
- server 单独跑/测:`bun run server/src/index.ts --port <p> --data-dir <d>` / `cd server && bun test`(**必须在 server/ 目录里跑,根目录跑会扫进前端测试**)
- 前端测试:`pnpm test`(根目录,vitest)
- **根目录仍用 pnpm**;**bun 只管 server sidecar**。切根 bun 排在 Phase F。

## 操作性 gotcha(不看会踩)

1. **Tauri app_data_dir** = `~/Library/Application Support/com.plonguo.knowhive/`。里面的 `config.yaml` 之前手工设了 `first_run_complete:true` 跳过旧 onboarding——**要真机验证新 onboarding 就把它改回 false(或删掉 config.yaml)**。改 db schema 后删 `knowhive.db*` 重建。
2. **CORS**:sidecar `app.use('*', cors())`,已加。
3. **AI SDK v7 + bun**:server 本地 zod@4;spike 要在 server 目录内跑;UIMessage→ModelMessage 手动映射。
4. **sqlite-vec**:db.ts 用 Homebrew libsqlite3,加载非致命;向量检索用暴力 KNN。
5. **RAGAS eval**:从 `backend/` 跑,`set -a; source ../.env; set +a`;TS sidecar 先起。语料 = `docs/leetcode/刷题知识库/`。
6. **PDF 未移植**:TS ingest 只支持 .md(Python 支持 .md+.pdf)。watcher/resync/re-embed 都只认 .md。要 PDF 得引 pdf.js/unpdf(roadmap Phase B 遗留风险项)。
7. **chat 无状态(有意)**:/chat 不落库,/chat/history 未移植,export/chat 返回空。完整 memory system(per-KB session + 三类长期记忆 + summarizer agent)排在迁移完成后,设计存在项目记忆里。
8. **community 搁置**:/community/* 未移植,CommunityBrowser 调它会 404(UI 静默处理)。

## 已工作 / 待办
- ✅ 全部核心服务在 TS sidecar:聊天流式、导入(带进度)、检索、知识树/编辑、设置、watcher 自动同步、review、overview/summary、export、onboarding
- ⏳ 真机 `tauri:dev` 验证新 onboarding + pull 进度(WKWebView)
- ⏳ chat.test.tsx 重写(测旧组件,Phase C 遗留)
- ❌ community、chat history、PDF、reranker(Phase E)、打包(Phase F)

## Roadmap
主线:真机验证 → Phase E(rerank:LLM-as-reranker 或 transformers.js spike)→ F(bun build --compile + 打包 + 清 Python/Electron + 根目录切 bun)。
新想法:R1 Tracing(Langfuse+Phoenix)、R2 prompt cache、R3 ✅ 已完成(并入 D8)、R4 markdown 质量门+AI润色+elbow阈值实验。迁移后:memory system(见项目记忆 project_memory_system)。
