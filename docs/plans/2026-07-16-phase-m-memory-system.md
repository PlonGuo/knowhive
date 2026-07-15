# Phase M: Memory System（M1 短期 + M2 长期 episodic/semantic）

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务实施。

**Goal:** chat 从无状态升级为「多会话持久化 + 短期窗口/水位线压缩 + episodic 落库 +
semantic 蒸馏进向量库并在检索时召回」。

**用户已定决策**：多会话 + 历史列表（Claude 式）；本 phase 只做 M1+M2（procedural/TTL
是 M3 下个 phase）；summarizer 跟随主模型（不加独立配置）。

**现状事实**：TS chat 完全无状态。`chat_messages`/`chat_summaries` 表 schema 已存在
（迁移遗产，仅 export.ts 读），无 session 维度；config 的 `chat_memory_turns`/
`memory_compression_threshold` 是死字段，本 phase 激活。行为参照：backend/app/services/
memory_compression_service.py（watermark = MAX(last_message_id)，超阈值摘要一段插新行）。

## 架构

```
/chat(session_id) ──► 载入会话上下文：
                        [semantic 记忆召回(top3, 相似度阈值) 注入 system]
                        [水位线以上的历史摘要 注入 system]
                        [最近 N 轮原文] + 新问题
                     ──► streamText(single/agentic 不变)
                     ──► onFinish: 持久化 user+assistant 消息
                          ├─ episodic 落库(question/answer/sources trace)
                          ├─ 压缩检查: 未摘要旧消息 > threshold → 摘要+推水位线
                          └─ 蒸馏(压缩时顺带): summarizer 从被压缩段提取持久事实
                                → embed → INSERT memories(semantic)
```

- **蒸馏挂在压缩时机**：压缩本来就要 LLM 读旧消息，蒸馏复用同一段输入（一次调用两个产出:
  摘要 + 事实列表 JSON），零额外轮次成本——这是本 phase 最值得讲的设计点
- semantic 召回用现有暴力 KNN 模式（chunks 同款），memories 表存 embedding BLOB

## Schema（db.ts 迁移）

- 新表 `sessions(id TEXT pk, title TEXT, created_at, updated_at)`
- `chat_messages` + `session_id TEXT`（ALTER，历史无真实数据）
- `chat_summaries` + `session_id TEXT`（水位线变 per-session）
- 新表 `memories(id, kind TEXT('episodic'|'semantic'), session_id, content TEXT,
  embedding BLOB NULL(episodic 不嵌入), created_at)`

## 任务

**Task 0（TDD）：schema 迁移 + 存储层**
- db.ts：迁移（PRAGMA table_info 检查列，无则 ALTER）+ 新表
- 新 `server/src/sessions.ts`：createSession/listSessions(按 updated_at 排序+title)/
  getMessages/appendMessage(顺带 touch session)/deleteSession(级联清 messages/summaries)
- 测试：迁移幂等、CRUD、级联删除
- Commit: `feat(memory): sessions + messages storage layer`

**Task 1（TDD）：短期记忆纯逻辑 `server/src/memory.ts`**
- `buildChatContext({history, summary, question, memories, turns})` → ModelMessage[] +
  system 注入块（摘要段 + 记忆段的拼接规则）
- `needsCompression(unsummarizedCount, threshold)`、`sliceForCompression(messages,
  watermark, keepTurns)`（Python 行为参照：水位线、阈值≤0 关闭）
- `parseDistillation(text)`：从 summarizer 输出提取 {summary, facts[]}（JSON 容错，
  参照 rerank.ts parseRanking 的容错风格）
- Commit: `feat(memory): short-term context assembly + watermark compression logic`

**Task 2：sessionRoutes + /chat 接线**
- 新 `server/src/sessionRoutes.ts`（DI）：POST /sessions、GET /sessions、
  GET /sessions/:id/messages、DELETE /sessions/:id
- chatRoutes：body 加 `session_id?`；有则载入上下文按 Task 1 组装;
  `toUIMessageStreamResponse` onFinish 持久化两条消息（title 为空时取首问前 40 字）+
  触发压缩/蒸馏（后台 fire-and-forget，失败只 log——fail-open 惯例）
- 无 session_id 行为完全不变（评估脚本/旧测试零影响）
- MockLanguageModelV3 集成测试：持久化、摘要注入、压缩触发（连发超阈值消息）、蒸馏落库
- Commit: `feat(memory): session-aware chat with compression + distillation hooks`

**Task 3：semantic 召回接线**
- /chat 组装上下文时：embed(question) → KNN over memories(kind=semantic) top3 +
  余弦阈值(初始 0.5, 可调)→ 注入 system「Relevant memories」块
- agentic 模式同样注入（工具不变）
- 测试：mock embedder+预置 memories 断言注入；阈值下不注入
- Commit: `feat(memory): semantic memory recall into chat context`

**Task 4：前端会话列表**
- Sidebar 加 Chats 区（Knowledge 区上方）：New chat 钮 + 会话列表（title+相对时间）+
  hover 删除;点击切换
- ChatArea：接 activeSessionId，载入历史（GET messages→useChat initialMessages 格式），
  body 带 session_id;新会话首条回复后刷新列表（title 出现）
- 测试：列表渲染/新建/切换载入/删除;现有 chat 测试不破（无 session 时行为不变）
- Commit: `feat(ui): conversation list + session switching`

**Task 5：e2e + 收尾**
- 真 Ollama 手动：多轮对话重启后续聊;第 21+ 轮触发压缩（threshold=20）;
  在 A 会话说过的事实在新会话 B 被召回——完整闭环演示
- config 默认值激活：`chat_memory_turns` 默认 0→6（0 仍=只带当前问题）
- HANDOFF/README 更新;learnings/Memory-System-Design.md（分层设计 + 蒸馏搭压缩时机的
  成本设计 + 与 CC compact 的对照）
- Commit: `docs: Phase M complete — layered memory shipped`

## Verification
- `cd server && bun test`（新增 ~25 测试）+ `bun run test`（前端）+ tsc 双侧
- Mock 集成测试盖住压缩/蒸馏触发路径（无真模型）
- 真机闭环：跨会话事实召回 demo
