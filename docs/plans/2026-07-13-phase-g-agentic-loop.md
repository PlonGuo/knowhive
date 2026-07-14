# Phase G: Agentic Loop — 单趟 RAG → 工具循环 Agent（KnowHive）

> **For Claude:** REQUIRED SUB-SKILL: 执行时用 superpowers:executing-plans 逐任务实施。
> 批准后先把本 plan 复制为 `docs/plans/2026-07-13-phase-g-agentic-loop.md`（repo 惯例）再开工。

## Context（为什么做）

迁移主线 A–F 收官后，项目向 Agent 方向演进，参照 `learnings/HARNESS_DEEP_DIVE.md`（Claude Code
harness 分析），为「本地知识库问答 Agent」落地有价值的 harness 子集。现状 `/chat` 是单趟管线
（retrieve 一次 → 注入 → 生成），模型无自主性，多跳问题（跨笔记对比/聚合）天然做不好。

**已定决策（用户确认）**：
1. 自研 loop，AI SDK v7（ai@7.0.9）底座——不引入 deepagents/LangGraph（与「删框架无退化」叙事一致）
2. 路线 G（只读 loop）→ H（写工具+权限）→ I（memory）→ J（cache/优化）；本 plan 只做 G
3. 评估闸：多跳问题集上量化对比单趟 vs agentic，延续 RAGAS 质量闸方法论

**Phase H 伏笔（本次不做但影响设计）**：AI SDK v7 原生审批流（`tool-approval-request/response`
chunks、`addToolApprovalResponse`）——权限系统 wire 协议现成，Phase G 的工具层设计不要挡路。

## 核心设计（Plan agent 产出，已复核）

### API 事实（ai@7.0.9 .d.ts 实测）
- `stopWhen` 默认 `isStepCount(1)`；多步用 `stepCountIs(N)`；`prepareStep` 可按步设
  `activeTools`/`toolChoice`；`onStepEnd` 回调
- `tool({description, inputSchema(zod v4 原生), execute(input, {abortSignal, toolCallId})})`
- `toUIMessageStreamResponse` 自动发 `tool-input-start/available`、`tool-output-available/error`
- `messageMetadata` 回调在 **start 和 finish 各调一次**（finish 时闭包里已是全量）→ sources 聚合基石
- `ai/test` 有 `MockLanguageModelV3` + `simulateReadableStream` → 无真模型可测完整 loop
- 前端 `ToolUIPart` type=`tool-${name}`，state ∈ input-streaming/input-available/output-available/output-error；
  `ai` 导出 `isToolUIPart`/`getToolName`

### 设计决策
1. **混合模式**（非纯 agentic）：agentic 分支仍首轮预检索注入 system prompt + 挂三个工具，prompt
   指示「上下文不足/需对比聚合时再调工具」。保底：llama3.2 (3B) 一次工具不调 = 现状单趟质量。
   工具指引段必须短（~5 行，小模型对长指令服从性差）。降级路径由 Task 0 spike 定：合法 tool-call
   率 ≥70% 走完整 loop；不可靠则 ollama 小模型静默单趟、loop 面向云 provider。
2. **sources 聚合**：每请求 new 一个 `SourceCollector`（Set 去重+保序，纯逻辑可单测），DI 进工具
   execute 收集命中路径；预检索 sources 预填；`messageMetadata: () => ({sources: sources.list()})`。
3. **模式切换**：`AppConfigSchema` 加 `chat_mode: z.enum(["single","agentic"]).default("single")`
   （G 期间默认 single，Task 8 按闸结果决定翻不翻）；`/chat` body 加可选 `mode` 覆盖（评估 A/B
   无 UI 逐请求切换）；Settings 页加开关。
4. **工具层**：新建 `server/src/agentTools.ts`——`buildAgentTools(deps: {retrieve, readNote,
   listNotePaths, sources})` 返回 ToolSet。要点：k 不暴露给模型（固定 AGENT_SEARCH_K=5，缩小
   3B 出错面）；**工具错误返回 `{error}` 值而非 throw**（throw → tool-output-error 打断小模型）；
   输出紧凑（chunk 只回 file_path/section/content 三字段，对冲 num_ctx=4096 窗口压力）；
   read_note 截断 6000 chars 带标记；list_notes 空参 schema（最稳）、截断 200 条。
5. **提取 `server/src/chatRoutes.ts`**（对齐 *Routes.ts DI 惯例）：`chatRoutes({getConfig,
   chatModel, retrieve, knowledgeDir})`；index.ts /chat 内联 handler 迁走。可用
   MockLanguageModelV3 写路由级集成测试（mock 模型第一步 tool-call、第二步文本）。
6. **终止**：`stopWhen: stepCountIs(6)` + `prepareStep: stepNumber >= 5 时 {activeTools: [],
   toolChoice: "none"}`——末步物理上无工具、必出文本（结构性保证）。
7. **前端**：ChatArea 从「聚合 text parts」改为**按 parts 顺序渲染**——text 照旧、tool part 渲染
   紧凑状态条（spinner/✓/✗ + "Searching: {query}" / "Reading: {path}"）；不展开工具输出 JSON
   （sources chip 已承担该职责）；`toolLabel/statusIcon` 抽纯函数。sources chip 逻辑零改动。
8. **评估**：新建 `backend/eval_dataset_multihop.json`（10 题，字段加 `expected_sources`；三类：
   跨笔记对比/聚合/链式，针对 docs/leetcode 刷题知识库语料）。扩展 `eval_ragas_ts.py`（不新建
   脚本）：`--mode single|agentic`；agentic 的 contexts 从 `tool-output-available` chunk 解析
   （测的就是模型实际检索到什么）；新增确定性指标 **`source_recall` = |expected ∩ actual| / |expected|**。

### 评估闸（Task 7 GATE）
| 闸 | 标准 |
|---|---|
| 多跳硬闸 | source_recall(agentic) > source_recall(single) |
| 多跳软闸 | RAGAS answer_relevancy、faithfulness：agentic ≥ single − 0.05 |
| 单跳回归闸 | 现有 20 题四指标 agentic ≥ single − 0.05（不倒退） |
| 行为数据（记录不设闸） | 平均步数、工具调用次数、tool-output-error 率、延迟 |

llama3.2 必跑；若小模型不达标，闸对云模型生效 + 结论进 learnings（联动降级路径决策）。

## 任务分解

**Task 0（GATE）Spike：llama3.2 经 ollama /v1 的 tool-call 可靠性**
- streamText + 假工具 + stepCountIs(4)，3 个多跳 prompt × 10 次：tool-call 发起率、参数 JSON
  合法率、流式 tool call 走通与否、结果回填后第二步行为、num_ctx 4096 vs 8192
- 闸：≥70% 合法率走完整 loop；否则确认降级路径、调整评估闸范围
- 产出 `learnings/Llama32-Tool-Call-Spike.md`；spike 脚本放 scratchpad 不提交

**Task 1（TDD）：SourceCollector + buildAgentTools**
- 建 `server/src/agentTools.ts` + 测试；`knowledge.ts` 加 `flattenTree`
- 断言：输出形状、截断、错误返回值分支、collector 去重保序

**Task 2（TDD）：buildAgentSystemPrompt**（`rag.ts` 扩展，与 buildSystemPrompt 并存）

**Task 3（TDD）：chat_mode 配置字段**（shared/schema.ts；默认 single、存量 yaml 兼容）

**Task 4：chatRoutes 提取 + agentic 分支（两个 commit）**
- 4A 纯搬迁：现有单趟逻辑迁入 `chatRoutes(deps)`，MockLanguageModelV3 集成测试打底
- 4B agentic 分支：`body.mode ?? config.chat_mode` 分派；预检索预填 collector → streamText
  (tools + stepCountIs(6) + prepareStep 末步禁工具) → messageMetadata 聚合 sources
- 手动验证：真 Ollama，curl /chat mode=agentic 看真流

**Task 5：前端 parts 渲染 + Settings 开关**
- ChatArea 按 parts 顺序渲染 + 工具状态条；chat.test.tsx 扩展 uiMessageStream mock 加 tool
  chunks（现有 7 用例断言不动——单趟 wire 格式零变化）；Settings 开关 + 测试
- 手动 `tauri:dev` 真对话看状态条

**Task 6：多跳数据集 + 评估脚本扩展**（先干跑 2 样本验证解析再全量）

**Task 7（GATE）：评估 A/B**——4 arm：{单跳20, 多跳10} × {single, agentic}；结果进
`backend/eval_results/`；产出 `learnings/Agentic-vs-SingleShot.md`（数据 + 行为分析 + 默认值决策）

**Task 8：收尾**——HANDOFF/README 更新；闸过则独立小 commit 翻 `chat_mode` 默认 agentic（好回滚）

依赖序：0 先行阻塞降级决策；1→2→3 均在 4 前；5 依赖 4；6→7 依赖 4；8 依赖 7。

## Verification
- `cd server && bun test`（工具层/协作器/路由集成全绿）；`bun run test`（前端）；tsc 双侧 clean
- 手动：真 Ollama e2e 多跳问题看 agent 多轮检索行为
- 评估闸四条（上表）——Task 7 出数据说话

## 关键文件
- server/src/index.ts（/chat 迁出 + 装配）、server/src/rag.ts、server/src/knowledge.ts（复用
  resolveSafePath/buildTree）、新 server/src/agentTools.ts、新 server/src/chatRoutes.ts
- src/components/layout/ChatArea.tsx、tests/src/chat.test.tsx、Settings 组件
- shared/schema.ts（+chat_mode；注意 backend/app/config.py 镜像同步惯例）
- backend/app/eval_ragas_ts.py、新 backend/eval_dataset_multihop.json
