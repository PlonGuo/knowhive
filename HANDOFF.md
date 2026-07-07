# HANDOFF — KnowHive 后端 TS/bun 迁移(交接给新 session)

> 单一入口文档。新 session 开场先读这个 + `git log --oneline -20` + `~/.claude/plans/obsidian-markdown-obsidian-cli-streamed-widget.md`(完整 roadmap)+ `learnings/`(决策依据)。

## 现在在哪(2026-07-02)

从 **Electron + Python 后端** 迁移到 **Tauri 壳 + TS/bun sidecar**。项目定位:**学习/作品集/面试**(不是产品),所以全栈重写是为了学习价值,不是用户价值。

- ✅ **Phase A/B/C 完成**:壳 spawn bun sidecar、bun:sqlite+FTS5、cosine KNN + RRF 混合检索、Ollama embedding、ingest、`/chat` 流式(AI SDK v7)、前端 `useChat`、**WKWebView 流式真机验证流畅**。
- ✅ **RAGAS 验证通过**:TS 无rerank 全面优于 Python 无rerank 基线,检索指标追平 Python 有rerank 基线。**迁移无退化。**
- ✅ **Phase D + R3 完成(D1–D8 共 8 个 commit)**:config / knowledge CRUD / ingest 任务进度 / watcher+sync / SM-2 review / summary / export / setup+ollama+onboarding 全部移植到 TS。**136 bun 测试绿**,每块都有真 Ollama e2e。
- ✅ **R3 onboarding 浏览器 e2e 通过(2026-07-04)**:headless Chromium + 真 sidecar + 真 Ollama pull 走完整流程——本地/云端两条路、语言切换更新所需模型、缺模型时 pull 进度条 0→100% 流式渲染后解锁 Next、完成态持久化。发现并修掉一个 bug(App.tsx 在 setup check 期间闪 AppLayout + 打旧 8000 端口)。chat.test.tsx 已按 useChat 重写(mock 用真机抓的 AI SDK v7 wire format)。**前端 vitest 253/253 全绿。**
- ✅ **Phase E1 完成(2026-07-04)**:LLM-as-reranker(20候选→llama3.2 listwise→top5,零依赖,fail-open)。RAGAS 复评:0.696/0.805/0.829/0.660,answer_relevancy +0.12,**追平 Python CrossEncoder 完整栈基线**。后续 k-sweep:recall 由 k 决定而非 rerank;coverage prompt 转正(learnings/Reranker-K-Sweep.md);顺带修了 startup sync 会删外部导入文件的继承 bug。
- ✅ **Phase E2 完成(2026-07-06)**:进程内 cross-encoder(bge-reranker-v2-m3 **int8 ONNX**,transformers.js 跑在 bun 里,571MB 懒加载单例)。RAGAS 质量闸**零掉点、四指标全面胜出 LLM 基线**:0.749/0.808/**0.914**/**0.780**;warm rerank ~1.25s vs LLM 2-8s,冷加载 892ms(缓存后)。**默认 `reranker_backend=cross-encoder`**,LLM 后备保留可切;/reranker/* 路由接真状态/下载。bun 注意:装依赖后要 `bun pm trust onnxruntime-node protobufjs`。
- ✅ **Phase F 完成(2026-07-08)——迁移收官**:
  - **Task 0 spike**:`bun build --compile` 单二进制**验证可行**(四层坑:dylib @rpath、sharp 动态 require、--external+compile 不兼容、bunfs 只读 cache),但工程权衡后**选 Path C**(bundle.js + 随包 bun runtime + 最小真实 node_modules)——Electron/VSCode 同款形态,细节见 `learnings/Bun-Compile-Native-Deps-Spike.md`(含回切触发条件)。
  - **Task 1 dist 构建**:`server/build-dist.ts`(bundle→合成 package.json→`bun install --production`→裁非本机 onnx 平台二进制 233→58MB);Rust release 分支 spawn 随包 bun;模型 cache 显式指到 data dir(.app resources 只读);`/reranker/download` 改异步+轮询(Bun.serve 10s idleTimeout 会杀长请求,全局提到 120s)。
  - **Task 2 发布闸抓到 2 个真 bug**:①lib.rs 拼 `resource_dir()/server` 但 Tauri 保留相对路径实际在 `resources/server` 下→release sidecar 永远起不来;②macOS Apple Events 退出路径不触发 ExitRequested→sidecar 变孤儿。双修:Rust 加 `RunEvent::Exit`,sidecar 加孤儿看门狗(ppid==1 自退)。7 项打包验证 API 级全绿(无 PATH bun 启动/导入/重排检索/chat 流式带 sources/watcher/export/重启持久无重下载)。**体积:.app 126MB(bun 60 + resources 58 + shell 8.8),dmg 43MB;模型 571MB 首次用时下到 data dir;冷加载 687ms。**
  - **Task 3**:Electron 全删(净删 3235 行);platform.ts 只剩 Tauri+浏览器分支;import 测试改 mock platform 模块。
  - **Task 4**:根目录 pnpm→bun(bun.lock;tauri.conf 前置命令改 `bun run`;**vitest 保留,经 `bun run test` 跑**)。
- 👉 **下一步:memory system**(见项目记忆 project_memory_system:per-KB session + 三类长期记忆 + summarizer agent),或预检索策略移植(HyDE/multi-query,config 有字段、pipeline 未实现)。

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
bun run tauri:dev        # 新终端(新终端才有 cargo,已写进 ~/.zshrc)
bun run tauri:build      # 出 .app + .dmg(src-tauri/target/release/bundle/)
```
前提:**Ollama 在跑**,且已装 `llama3.2`、`nomic-embed-text`、`bge-m3`。
- server 单独跑/测:`bun run server/src/index.ts --port <p> --data-dir <d>` / `cd server && bun test`(**必须在 server/ 目录里跑,根目录跑会扫进前端测试**)
- 前端测试:`bun run test`(根目录,vitest——**不是 `bun test`**,那会用错 runner)
- **全仓 bun**(Phase F Task 4 起);pnpm 已退役。

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
- ✅ **迁移收官**:全部核心服务在 TS sidecar(聊天流式、导入进度、混合检索+双后端 rerank、知识树/编辑、设置、watcher、review、summary、export、onboarding),Tauri 打包发布闸通过,Electron/pnpm 已清,Python 只剩 RAGAS eval harness。
- ⏳ 打包 onboarding UI 目测(把 app data dir 的 config.yaml `first_run_complete` 改 false 再开 .app)——API 级已验,只差眼睛。
- ❌ 未做:memory system、预检索策略(HyDE/multi-query)、PDF、chat history、community、R1 tracing、R4 markdown 质量门。

## Roadmap
迁移主线(A–F)**已全部完成**。下一步候选(按项目记忆优先级):
1. **Memory system**(project_memory_system:per-KB session + procedural/semantic/episodic 长期记忆 + summarizer agent 蒸馏)
2. 预检索策略移植 + auto 路由(project_auto_strategy)
3. Ollama faithfulness 提升(project_faithfulness:0.72 vs OpenAI 0.92)
4. PDF 支持 / R1 Tracing(Langfuse+Phoenix)/ R4 markdown 质量门 / community
