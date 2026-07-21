# Claude Code Harness 深度解析：如何打造世界级 AI 编程工具

> 本文档基于对 Claude Code 源码的逆向分析，系统性地拆解其 Harness（LLM 调度框架）的设计。
> 不涉及模型能力本身，只关注工程层面做了什么。

## 目录

- [1. 系统提示词工程](#1-系统提示词工程)
- [2. 核心查询循环](#2-核心查询循环)
- [3. 上下文管理与压缩](#3-上下文管理与压缩)
- [4. 权限与安全系统](#4-权限与安全系统)
- [5. Agent/子 Agent 架构](#5-agent子agent-架构)
- [6. 设计哲学总结](#6-设计哲学总结)
- [附录 A：关键文件索引](#附录-a关键文件索引)

---

## 1. 系统提示词工程

这是 Claude Code 最核心的竞争力之一。提示词不是一个静态字符串，而是一个**动态组装管线**。

### 1.1 分层缓存架构

`src/constants/prompts.ts` 中，系统提示词被一个 **boundary marker** 分为两部分：

```
┌─────────────────────────────────────────────┐
│  STATIC SECTIONS (全局可缓存)                  │
│  ├─ 身份定义："You are Claude Code..."        │
│  ├─ 工具使用规则                              │
│  ├─ 代码风格指南                              │
│  ├─ 安全行为准则                              │
│  └─ 输出效率要求                              │
├─────── DYNAMIC BOUNDARY ────────────────────┤
│  DYNAMIC SECTIONS (每轮可变)                   │
│  ├─ 环境信息 (OS, shell, git status)          │
│  ├─ CLAUDE.md 内容                            │
│  ├─ 记忆系统 (MEMORY.md)                      │
│  ├─ MCP 服务器指令 (每轮重算)                  │
│  ├─ 语言偏好                                  │
│  └─ 输出风格配置                              │
└─────────────────────────────────────────────┘
```

**关键设计**：静态部分跨用户缓存（`scope: 'global'`），动态部分按组织缓存（`scope: 'org'`）或不缓存。这在 `src/utils/api.ts` 的 `splitSysPromptPrefix()` 中实现，将提示词切分为 3-4 个 block，每个带独立的 `cache_control`。

**三种缓存策略**（取决于运行环境）：

| 场景 | Block 数 | 缓存范围 |
|------|---------|---------|
| 有 MCP 工具 | 3 | 全部 'org' scope（工具可能随时连接/断开） |
| 1P + 有 boundary | 4 | 静态部分 'global'，动态部分不缓存 |
| 默认 / 3P | 3 | 全部 'org' scope |

**「区分」靠 sentinel 字符串精确匹配，不靠模型解析**。`splitSysPromptPrefix()` 遍历 prompt 数组，用三个哨兵把块归类（`api.ts:321-435`）：

```
for (block of systemPrompt):
  block.startsWith('x-anthropic-billing-header')  → 归属头     cacheScope=null
  CLI_SYSPROMPT_PREFIXES.has(block)                → 身份前缀   cacheScope='org' 或 null
  block === SYSTEM_PROMPT_DYNAMIC_BOUNDARY         → 切分哨兵   continue（跳过，不进请求）
    ├─ boundary 之前 → static blocks   cacheScope='global'
    └─ boundary 之后 → dynamic blocks  cacheScope=null
  其余                                              → rest      cacheScope='org'
```

随后 `buildSystemPromptBlocks()`（`claude.ts:3214-3238`）把每块的 `cacheScope` 翻译成实际的 `cache_control`，`cacheScope === null` 的块直接不带缓存标记。

**两个易混淆点**：

1. **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 永不进入 API 请求**——它被 `continue` 跳过，纯粹是代码内部的切割记号，模型看不到。
2. **缓存切分 ≠ tool dispatch，是两套独立机制**。API 请求里 `system`（带 cache_control 的文本块）、`tools`（独立字段，schema 数组，自带 cache_control）、`messages` 是三个不同字段。系统提示词的 global/org 区分只影响 `system` 字段里 `cache_control` 的落点；模型最终只看到拼接好的文本 + 一份工具清单，对这些缓存边界毫无感知。

### 1.2 Section 注册与失效

`src/constants/systemPromptSections.ts` 实现了声明式的 section 管理：

- `systemPromptSection()` — 缓存到 `/clear` 或 `/compact`
- `DANGEROUS_uncachedSystemPromptSection()` — 每轮重算，值变化时打破缓存

这意味着 MCP 指令（可能随时连接/断开服务器）每轮都重新计算，而环境信息只算一次。

**动态 Section 清单**：

| Section 名称 | 类型 | 内容 |
|-------------|------|------|
| `session_guidance` | cached | Agent 工具、fork 子 agent、skill 发现 |
| `memory` | cached | MEMORY.md 记忆内容 |
| `env_info_simple` | cached | 环境、git 状态、模型信息 |
| `language` | cached | 用户语言偏好 |
| `output_style` | cached | 自定义输出风格 |
| `mcp_instructions` | **uncached** | MCP 服务器指令（每轮重算） |
| `scratchpad` | cached | Scratchpad 目录 |
| `frc` | cached | Function Result Clearing |
| `summarize_tool_results` | cached | 工具结果摘要规则 |

### 1.3 动态上下文注入

`src/context.ts` 异步并行构建上下文：

- **Git 状态**：会话开始时一次性捕获（branch、status、recent commits），截断到 2000 字符
- **CLAUDE.md 发现**：沿目录树向上遍历，加载多层级配置文件
- **@include 指令**：支持 `@path`、`@./relative`、`@~/home`，有循环引用检测
- **日期注入**：`Today's date is 2026-04-01` — 看似简单但极其重要

**CLAUDE.md 加载优先级**（从低到高）：

```
1. Managed Memory  (/etc/claude-code/CLAUDE.md)
2. User Memory     (~/.claude/CLAUDE.md)
3. Project Memory  (CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md)
4. Local Memory    (CLAUDE.local.md - 私有，不提交到 VCS)
```

### 1.4 模型感知的提示词

提示词根据模型调整：

- 不同模型不同的 knowledge cutoff 日期（Opus 4.6: May 2025, Sonnet 4.6: Aug 2025, Haiku 4.5: Feb 2025）
- 模型名称和 ID 注入，让模型了解自身
- Fast mode 说明（"同一模型，更快输出，不切换模型"）

### 1.5 系统提示词组装优先级

`src/utils/systemPrompt.ts` 定义了清晰的优先级：

```
1. Override prompt    — 完全替代（loop 模式）
2. Coordinator prompt — 协调者模式
3. Agent prompt       — 领域指令（proactive 模式下追加到默认提示词）
4. Custom prompt      — --system-prompt 参数
5. Default prompt     — 标准 Claude Code 提示词
6. Append prompt      — 后缀追加
```

---

## 2. 核心查询循环

这是 Harness 的心脏。位于 `src/query.ts`（1,732 行）。

### 2.1 Generator-Based 流式架构

```typescript
async function* query(params): AsyncGenerator<StreamEvent> {
  while (true) {
    // 1. 自动压缩检查
    // 2. 调用 API（流式）
    // 3. 收集 tool_use blocks
    // 4. 执行工具
    // 5. 收集结果，准备下一轮
    // 6. 检查终止条件
  }
}
```

**核心设计**：`query()` 是一个 **async generator**，用 `yield` 逐条推送消息给 UI。这意味着：

- 消息在流式到达时立即可见
- 状态通过闭包传递，不依赖数据库
- 每次迭代内存效率高

### 2.2 工具执行的双通道

**先厘清两条时间线**——容易被混为一谈：

| | A. 调用**前**（纯代码，模型不参与） | B. 调用**后**（模型决定） |
|---|---|---|
| 干什么 | 组装 system prompt、切缓存块、把工具 **schema 清单** 塞进 `tools` 字段 | 模型吐出 `tool_use` block（带 `name` + `input` + `id`） |
| 谁决定 | Claude Code 的 deterministic 代码 | 大模型 |
| 「标签」从哪来 | 代码往 prompt 埋 sentinel 做缓存切分（见 1.1） | 模型生成 `type: "tool_use"` 结构化块 |

关键：`tool_use` 那个「标签」**不是 CC 在调用前打的，而是模型生成的结构化输出**。调用前 CC 只准备「工具菜单」，点菜的是模型，CC 的活儿是把模型选的 `name` **翻译回本地函数**并调度执行。

**双通道由 feature gate 切换**（`query.ts:561-568`）：

```
config.gates.streamingToolExecution
  ├─ true  → StreamingToolExecutor  (边流式边执行，tool 与模型并行)
  └─ false → runTools (toolOrchestration.ts，等流完再批量执行)
```

**① 从响应流捞出 tool_use**（`query.ts:832-847`）：每条 assistant 消息到达就 filter 出 `type === 'tool_use'` 的块，`needsFollowUp = true` 是「循环要继续」的唯一信号。流式模式下立刻 `addTool` 送进执行器，不等模型说完：

```ts
const msgToolUseBlocks = content.filter(c => c.type === 'tool_use')
if (msgToolUseBlocks.length > 0) {
  toolUseBlocks.push(...msgToolUseBlocks)
  needsFollowUp = true
}
for (const toolBlock of msgToolUseBlocks)
  streamingToolExecutor.addTool(toolBlock, assistantMessage)  // 模型还在吐 token 就已开始执行
```

**② name → 本地函数的翻译 + 校验**（`runToolUse`，`toolExecution.ts:337-374, 615`）：

```ts
let tool = findToolByName(toolUseContext.options.tools, toolName)  // 模型给的字符串 → 本地 Tool 对象
// 查不到 → 试 deprecated 别名 → 仍查不到 → 回 <tool_use_error>No such tool available</tool_use_error>
const parsedInput = tool.inputSchema.safeParse(input)             // 用工具自己的 zod schema 校验入参
```

`findToolByName` 是「翻译」的核心；`safeParse` 防止模型给的非法 `input` 直接打到工具实现。

**③ 并发安全调度**——两套执行器共用判据 `tool.isConcurrencySafe(parsedInput.data)`：

| 通道 | 机制 | 行为 |
|------|------|------|
| 批量 | `partitionToolCalls`（`toolOrchestration.ts:91-116`） | 连续只读工具切成一个 batch 并发跑（上限 10），非只读工具串行独占 |
| 流式 | `canExecuteTool`（`StreamingToolExecutor.ts:129-135`） | 并发安全工具可互相并行；非并发安全工具必须独占 |

**④ Bash 错误熔断兄弟工具**（`StreamingToolExecutor.ts:359-363`）——文档之前漏掉的关键细节：

```ts
if (isErrorResult && tool.block.name === BASH_TOOL_NAME) {
  this.hasErrored = true
  this.siblingAbortController.abort('sibling_error')  // 杀掉并行的其它子进程
}
```

理由：Bash 命令常有隐式依赖链（`mkdir` 失败 → 后续命令无意义），所以**只有 Bash 错误**取消兄弟；Read/WebFetch 这类独立操作一个失败不波及其它。

**一次 tool use 的完整生命周期**：

```
[调用前·代码]  组装 system(切 global/org 块) + tools(schema 清单) → 发请求
[模型]         流式吐出: text... + { type:"tool_use", name:"Bash", input:{...}, id:"toolu_x" }
[捞取]         query.ts filter type==='tool_use' → needsFollowUp=true
[翻译]         findToolByName("Bash") → 本地 Tool 对象
[校验]         inputSchema.safeParse(input)
[权限]         canUseTool (permission 引擎 + AST 安全分析)
[执行]         tool.call() → 流式 yield 结果 → 包成 tool_result 消息
[回灌]         tool_result 追加进 messages → 进入下一轮循环
```

**流式工具执行**（`StreamingToolExecutor`）的本质是性能优化：模型还在输出后续 token 时，已经开始执行前面到达的工具调用，对用户意味着更短的端到端延迟。

### 2.3 错误恢复三层防线

| 错误类型 | 恢复策略 | 代码位置 |
|---------|---------|---------|
| **prompt_too_long** | 先尝试 context collapse → 再尝试 reactive compact → 放弃 | query.ts:1068-1186 |
| **max_output_tokens** | 先升级限制(8K→64K) → 最多重试3次+nudge消息 | query.ts:1188-1259 |
| **模型降级** | FallbackTriggeredError → tombstone 旧消息 → 切换模型重试 | query.ts:897-956 |

**关键细节**：错误是 **"withheld"（扣留）** 的——先不告诉用户，尝试恢复，只有恢复失败才显示错误。这个"错误扣留"模式是优秀 UX 的关键。

### 2.4 消息不可变性

```
规则：消息永远只追加，不修改、不删除
需要"删除"时 → 发送 tombstone 消息（移除信号）
```

这保证了 **prompt cache 稳定性**（API 请求的消息数组字节级一致）。这是一个容易被忽视但极其重要的设计——任何消息的修改都会导致 cache miss，增加 token 成本。

### 2.5 Turn 管理与循环终止

核心循环 `queryLoop`（`src/query.ts`）虽然注释里写着 "recursive call"（历史遗留），实际是一个 `while (true)` 状态机 + `state` 重赋值 + `continue` 的结构。**一次循环迭代 = 一次 LLM API 调用 + （可能的）工具执行**。

从外部看，用户发一次 query → `queryLoop` 跑 N 轮 → N 次 API 调用 → 循环 `return` 时用户才拿到最终回答。这 N 次调用对用户无感——这正是「一次提问背后多次后台 LLM 调用」的来源。

**一轮迭代的时间线**：

```
                    一次用户 query
                          │
                          ▼
        ┌──────────────── while(true) 一轮迭代 ────────────────┐
        │                                                       │
        │  ① 顶部:启动后台预取(非阻塞)                       │
        │     ├─ skill discovery prefetch   ─┐                  │
        │     └─ (memory prefetch 在循环外,每 turn 启动一次)─┐ │
        │                                     │              │  │
        │  ② LLM 流式调用(5-30s)───────────┼──────────────┼──│  后台 Haiku/
        │     收集 assistantMessages          │ 藏在这段时间 │  │  prefetch 并行跑
        │     有 tool_use? ──no──► 终止路径    │              │  │
        │             │yes                    │              │  │
        │             ▼                       │              │  │
        │  ③ 执行工具 → toolResults[]         │              │  │
        │             │                       │              │  │
        │  ④ 注入(全部 append 进 toolResults)◄┘◄─────────────┘  │
        │     ├─ 排队命令 (task notif/prompt)                    │
        │     ├─ 文件编辑通知 (edited_text_file)                 │
        │     ├─ 记忆文件 (prefetch settled 才消费)              │
        │     ├─ skill discovery (收割顶部的 prefetch)           │
        │     └─ 工具摘要 → 不在本轮,留到 ⑤                     │
        │             │                                          │
        │  ⑤ 组装下一轮 user 消息:                              │
        │     [旧消息 + assistant + toolResults]                 │
        │     + 上一轮的工具摘要(在下一轮开头 yield)           │
        │             │                                          │
        │     maxTurns? ──超过──► 终止                           │
        │             │                                          │
        └─────────────┼──── continue,回到 ① ────────────────────┘
                      ▼
              (无 tool_use 时)return → 用户拿到最终回答
```

**关键设计**：所有注入都不是作为独立的 user 消息穿插，而是统一 append 进 `toolResults` 数组，跟工具结果打包成**下一轮** LLM 调用的输入。原因见 `query.ts:1538` 注释——API 不允许 `tool_result` 与普通 user message 交错。所以注入发生在「turn 之间」，绑定在 tool_result 那条 user 消息上；终止的那一轮（无 tool_use）不做这些注入。

**终止条件**（LLM 调用后散落在多个检查点）：

| 终止原因 | 位置 | 触发 |
|---------|------|------|
| `completed` 自然结束 | `query.ts:1360` | 模型没返回 tool_use，且过了所有恢复/hook 检查 |
| `aborted_tools` | `query.ts:1518` | 工具执行中收到 abort |
| `aborted_streaming` | `query.ts:1054` | 流式期间被中断 |
| `hook_stopped` | `query.ts:1523` | hook 发 `hook_stopped_continuation` |
| `stop_hook_prevented` | `query.ts:1282` | stop hook 阻止继续 |
| `max_turns` | `query.ts:1708` | `nextTurnCount > maxTurns`，yield `max_turns_reached` |
| token budget 完成 | `query.ts:1346` | 预算耗尽 |
| `prompt_too_long` / `image_error` | `query.ts:1178` | 压缩恢复也救不回来 |

此外有几条**不终止、而是 `continue` 重跑**的恢复路径（也算轮间穿插）：prompt-too-long → context collapse drain / reactive compact；max_output_tokens → 升档 64k 重试或注入「继续写」恢复消息；stop hook blocking error → 注入 error 再跑；token budget 有余 → 注入 nudge 继续。

**每轮之间的注入**（均 append 进 `toolResults`，`query.ts:1583-1631`）：

| 注入项 | 位置 | 机制 |
|--------|------|------|
| 排队命令 (task notification / prompt) | `query.ts:1573` | drain 队列转成 attachment |
| 文件编辑通知 (edited_text_file) | `query.ts:1583` | `getAttachmentMessages` |
| 记忆文件 (memory prefetch) | `query.ts:1602` | 循环**外**每 turn 启动一次（`query.ts:301`），每轮轮询 `settledAt`，settled 才消费注入 |
| Skill discovery | `query.ts:1623` | 顶部（`query.ts:331`）每轮启动的 prefetch 在这里收割 |
| 工具使用摘要 (Haiku, fire-and-forget) | 生成于 `query.ts:1472`，**下一轮**开头 `query.ts:1058` 才 yield | 用下一次流式的 5-30s 把 Haiku 的 ~1s 藏掉 |

> 注意区分:记忆 prefetch 是**每个 user turn 启动一次**（消费才是每轮轮询）；skill discovery 才是真正 per-iteration 启动。

### 2.6 API 客户端关键设计

`src/services/api/claude.ts`（3,420 行）中的重要机制：

**Beta Header Sticky Latching**：Beta 头一旦发送就保持整个 session——防止 cache key 翻转。AFK mode、fast mode、cache editing 等都用 latch 控制。

**Watchdog 超时**：

- 45 秒无活动 → 警告日志
- 90 秒无活动 → 终止请求
- \>30 秒事件间隔 → 记录 stall 日志

**Stop Reason 处理**：

| Stop Reason | 行为 |
|------------|------|
| `end_turn` | 正常结束 |
| `tool_use` | 需要执行工具，继续循环 |
| `max_tokens` | 触发 max output tokens 恢复 |
| `refusal` | 生成拒绝错误消息 |

---

## 3. 上下文管理与压缩

Claude Code 用**多层压缩**解决了 LLM 最大的限制——上下文窗口。

### 3.1 压缩层次

```
第1层：Microcompact (最轻量)
  └─ 清除旧的工具输出，替换为 "[Old tool result content cleared]"
  └─ 仅清除特定工具: Read, Bash, Grep, Glob, WebSearch, WebFetch, Edit, Write
  └─ 两种变体:
      ├─ Cached Microcompact: 利用 API cache_edits 特性，保持 cache hit
      └─ Time-based Microcompact: 清除超过时间阈值的旧结果

第2层：Session Memory Compact (中等)
  └─ 用提取的会话记忆替代完整历史
  └─ 不调用 LLM，速度快
  └─ 配置: minTokens=10K, minTextBlockMessages=5, maxTokens=40K

第3层：Auto-Compact (最重量级)
  └─ 调用 Claude 生成对话摘要
  └─ 摘要后重新注入关键上下文
  └─ 有 prompt-too-long 重试逻辑（最多3次，逐步丢弃最旧消息组）

第4层：Reactive Compact (运行时兜底)
  └─ 捕获 API 的 prompt_too_long 错误
  └─ 紧急压缩后重试请求
```

### 3.2 自动压缩触发时机

```
有效上下文 = 上下文窗口 - 20,000 (预留给摘要输出)
自动压缩阈值 = 有效上下文 - 13,000

例: 200K 窗口 → 有效 180K → 在 167K tokens 时触发
例: 1M 窗口 → 有效 980K → 在 967K tokens 时触发
```

**断路器**：连续 3 次压缩失败后停止重试，防止 API 反复调用。

### 3.3 大型工具输出持久化

`src/utils/toolResultStorage.ts` 解决了工具输出过大的问题：

```
工具输出 > 50K 字符？
  → 写入磁盘: .claude/sessionId/tool-results/{toolUseId}.txt
  → 替换为引用 + 2KB 预览:

    <persisted-output>
    Output too large (2.3MB). Full output saved to: /path/to/output.txt

    Preview (first 2KB):
    [前 2000 字节]
    ...
    </persisted-output>
```

模型可以在需要时用 Read 工具读取完整输出。**这比截断优雅得多**——信息不丢失，只是按需加载。

### 3.4 压缩后的上下文恢复

压缩不是简单地截断。压缩后会**智能恢复**关键上下文：

```
压缩后消息结构:
1. Compact boundary marker (系统消息，带元数据)
2. 摘要消息 (LLM 生成的对话总结)
3. 文件附件 (最近使用的 top 5 文件，每个限 5K tokens，总共 50K budget)
4. Skill 附件 (已激活的 skills，每个限 25K tokens)
5. Plan 附件 (如果在 plan mode)
6. MCP 指令增量 (新增/移除的工具和指令)
7. Agent 列表增量 (可用 agent 变化)
8. Deferred tools 增量 (工具 schema 变化)
9. Session start hook 结果
```

**设计决策**：Skill listing 故意不在压缩后重新注入（因为重新注入 = 纯 cache_creation 成本），只注入已被调用的 skill 内容。

### 3.5 文件状态缓存

`src/utils/fileStateCache.ts` 维护 LRU 缓存：

```
├─ 最大条目: 100 个文件
├─ 最大总量: 25MB
├─ 淘汰策略: LRU + 基于大小的淘汰
├─ 路径归一化: 防止重复条目
└─ 压缩后恢复: 选择 top 5 文件重新注入
```

### 3.6 文件历史跟踪

`src/utils/fileHistory.ts` 在每次文件修改时创建快照：

```
├─ 最大 100 个快照/会话
├─ 单调递增的 snapshotSequence（活动信号）
├─ 支持回滚到任意快照
└─ 可通过 CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING 禁用
```

---

## 4. 权限与安全系统

这是让 Claude Code 能够安全执行代码的关键。

### 4.1 五级权限模式

| 模式 | 行为 | 场景 |
|-----|------|-----|
| `default` | 每次询问用户 | 标准交互模式 |
| `acceptEdits` | 自动批准文件操作 | 信任模式 |
| `plan` | 只读+规划 | 安全探索 |
| `bypassPermissions` | 全部自动批准 | YOLO 模式 |
| `auto` | AI 分类器自动判断 | 智能模式 |

### 4.2 权限决策流程

```
命令到达
  ↓
1. 精确匹配 Allow 规则 → ALLOW (最高优先级)
  ↓
2. Deny 规则 (精确+前缀) → DENY
  ↓
3. 路径约束检查 → DENY/ASK/PASSTHROUGH
  ↓
4. Ask 规则 (精确+前缀) → ASK
  ↓
5. 权限模式决策:
   - bypassPermissions → ALLOW (全部)
   - dontAsk → DENY (全部)
   - default → PASSTHROUGH (询问用户)
   - acceptEdits → ALLOW (仅文件操作)
   - plan → 受限子集
   - auto → 分类器决策
  ↓
6. 只读命令检查 → ALLOW
  ↓
7. PASSTHROUGH (询问用户)
```

**规则来源**（从高到低）：cliArg → policySettings → flagSettings → projectSettings → localSettings → userSettings

### 4.3 Bash 命令的 AST 级安全分析

`src/utils/bash/ast.ts` 使用 **tree-sitter-bash** 做 AST 解析，这是最精密的安全层：

```
命令到达
  ↓
AST 解析 → 提取 argv, 环境变量, 重定向
  ↓
危险扩展检测 (任何一项命中 → too-complex → 必须询问):
  ├─ 命令替换 $(...)     ├─ 进程替换 <(...)
  ├─ 算术扩展 $((...))   ├─ 参数扩展 ${VAR...}
  ├─ 大括号扩展 {a,b}    ├─ 子shell/复合语句
  └─ Heredoc (未引用分隔符)
  ↓
语义检查:
  ├─ eval/source/exec        → 阻止（可执行任意代码）
  ├─ 数组下标注入 test -v 'a[$(id)]' → 阻止
  ├─ jq system() 函数        → 阻止
  ├─ /proc/*/environ 访问    → 阻止（泄露密钥）
  └─ 空命令名               → 阻止（扩展可能误判）
  ↓
包装器剥离:
  time/nohup/timeout/nice/env CMD → 检查内部 CMD
  ↓
权限规则匹配
```

**核心原则：Fail-Closed**——任何未在白名单中的 AST 节点类型都触发 `too-complex`，必须用户确认。

### 4.4 环境变量安全白名单

```
永远不白名单（允许代码注入）:
  PATH, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_*
  PYTHONPATH, NODE_PATH, CLASSPATH
  GOFLAGS, RUSTFLAGS, NODE_OPTIONS
  HOME, TMPDIR, SHELL, BASH_ENV

安全白名单（规则匹配时可忽略）:
  NODE_ENV, RUST_LOG, PYTHONUNBUFFERED
  LANG, LC_ALL, TZ, TERM, NO_COLOR, FORCE_COLOR
  ANTHROPIC_API_KEY
```

### 4.5 破坏性操作检测

`src/tools/BashTool/destructiveCommandWarning.ts` 对危险 Git/文件/数据库/基础设施命令发出警告：

**Git 操作**：
| 命令模式 | 警告 |
|---------|------|
| `git reset --hard` | "may discard uncommitted changes" |
| `git push --force` | "may overwrite remote history" |
| `git clean -rf` | "may permanently delete untracked files" |
| `git checkout .` | "may discard all working tree changes" |
| `git commit --amend` | "may rewrite the last commit" |
| `git commit --no-verify` | "may skip safety hooks" |

**文件/数据库/基础设施**：
| 命令模式 | 警告 |
|---------|------|
| `rm -rf` | "may recursively force-remove files" |
| `DROP/TRUNCATE TABLE` | "may drop or truncate database objects" |
| `kubectl delete` | "may delete Kubernetes resources" |
| `terraform destroy` | "may destroy infrastructure" |

### 4.6 分类器系统（Auto 模式）

Auto 模式使用 AI 分类器判断命令安全性：

**分类器跳过（总是安全）**：
File Read, Grep, Glob, LSP, Tool Search, TodoWrite, AskUserQuestion, Sleep, EnterPlanMode, ExitPlanMode, SendMessage, ...

**分类器评估**：
Bash, FileEdit, FileWrite, Agent, MCP tools, ...

**防御机制**：

```
├─ 进入 auto 模式时，自动剥离危险的 allow 规则
│  (防止类似 Bash(*) 这样的规则绕过分类器)
├─ 连续 3 次拒绝 → 回退到人工确认
├─ 总计 20 次拒绝 → 回退到人工确认
└─ 退出 auto 模式时恢复被剥离的规则
```

**危险模式列表**（auto 模式下阻止自动批准）：

```
代码执行: python, node, deno, tsx, ruby, perl, php, lua
包管理: npm run, yarn run, pnpm run, bun run, bunx, npx
Shell: bash, sh, zsh, fish, eval, exec, env, xargs, sudo, ssh
```

### 4.7 Hook 系统

用户可以定义 shell hooks 在工具执行前后运行：

**PermissionRequest Hook**：

```
执行时机: 工具权限请求时
可以:
  ├─ allow — 自动批准
  ├─ deny — 自动拒绝（带消息）
  ├─ skip/null — 交给默认逻辑
  ├─ updatedPermissions — 持久化新规则
  └─ interrupt: true — 终止整个会话
```

**Agent Hook (Stop Hook)**：

```
执行时机: Agent 完成工具执行后
行为: 生成一个验证子 Agent 检查条件
限制: 最多 50 轮对话
返回: success / blocking / cancelled
用途: 确保 Agent 正确完成任务后才继续
```

---

## 5. Agent/子 Agent 架构

这是 Claude Code 实现复杂任务分解的核心机制。

### 5.1 Agent 类型谱系

```
┌──────────────────────────────────────────────┐
│  Built-in Agents                              │
│  ├─ General Purpose (全工具访问，默认)         │
│  ├─ Explore (只读: Glob+Grep+Read, Haiku)    │
│  ├─ Plan (只读: 架构设计, inherit model)      │
│  ├─ Verification (代码审查)                   │
│  ├─ Claude Code Guide (框架指南)              │
│  └─ Fork (继承父上下文的分支, prompt cache 复用)│
├──────────────────────────────────────────────┤
│  Custom Agents (用户定义, Markdown frontmatter)│
│  ├─ User settings agents (~/.claude/)         │
│  ├─ Project settings agents (.claude/)        │
│  └─ Plugin agents                             │
└──────────────────────────────────────────────┘
```

### 5.2 Agent 定义结构

```typescript
type AgentDefinition = {
  agentType: string              // 唯一标识
  whenToUse: string              // 何时使用描述
  tools?: string[]               // 白名单（默认 ['*']）
  disallowedTools?: string[]     // 黑名单
  skills?: string[]              // 预加载 skill 名称
  mcpServers?: AgentMcpServerSpec[]  // Agent 专属 MCP 服务器
  hooks?: HooksSettings          // Session-scoped hooks
  color?: AgentColorName         // UI 颜色
  model?: string                 // 'sonnet' | 'opus' | 'haiku' | 'inherit'
  effort?: EffortValue           // 输出深度控制
  permissionMode?: PermissionMode // 权限级别
  maxTurns?: number              // 最大轮数限制
  background?: boolean           // 强制后台执行
  initialPrompt?: string         // 预注入第一轮的提示
  memory?: AgentMemoryScope      // 'user' | 'project' | 'local'
  isolation?: 'worktree'         // Git worktree 隔离
  omitClaudeMd?: boolean         // 跳过 CLAUDE.md（节省 token）
  getSystemPrompt: (params) => string  // 系统提示词构建函数
}
```

### 5.3 工具过滤金字塔

```
所有可用工具
  ↓ 来源过滤 (非内置 Agent 不能使用 Agent 工具，防止无限递归)
  ↓ 权限模式过滤 (review 模式过滤写工具)
  ↓ 白名单 (tools: ['Glob', 'Grep', 'Read'])
  ↓ 黑名单 (disallowedTools: ['Bash'])
  = 最终工具池
```

### 5.4 六维隔离模型

| 隔离维度 | 机制 | 效果 |
|---------|------|-----|
| **文件系统** | Git worktree | 独立仓库副本，无 VCS 冲突 |
| **权限** | 独立 permissionMode | Agent 不能超越其安全级别 |
| **工具** | 白名单/黑名单 | Agent 只能看到指定工具 |
| **上下文** | Fork vs Fresh | Fork 继承父上下文；Fresh 全新开始 |
| **MCP** | Agent-specific 服务器 | 额外的 MCP 服务器（附加到父的） |
| **Remote** | CCR 环境 | 独立机器，完全沙箱 |

### 5.5 Fork 子 Agent 的缓存优化

这是一个非常精妙的设计：

```
普通子 Agent:
  → 全新系统提示词
  → 全新 prompt cache
  → Cache MISS（需要重建缓存）

Fork 子 Agent:
  → 复用父的系统提示词（字节级一致）
  → 复用父的工具池（useExactTools=true）
  → Prompt cache HIT（巨大的成本节约）
```

Fork Agent 的系统提示词直接使用 `toolUseContext.renderedSystemPrompt`——与父完全相同的字节序列，确保 API 端的 prompt cache 命中。

### 5.6 同步 vs 异步 Agent

**决策逻辑**：

```typescript
shouldRunAsync = (
  run_in_background === true ||
  selectedAgent.background === true ||
  isCoordinator ||
  forceAsync ||        // fork 子 agent
  assistantForceAsync  // KAIROS 模式
) && !isBackgroundTasksDisabled
```

**异步 Agent 生命周期**：

```
注册 (status=running, isBackgrounded=true)
  ↓
后台执行 (不阻塞父对话)
  ↓
进度追踪:
  ├─ toolUseCount (工具调用次数)
  ├─ token 消耗
  └─ 最近 5 个活动 ("Reading src/foo.ts", "Editing auth.ts")
  ↓
完成/失败
  ↓
发送 <task-notification> XML 消息给父
  ├─ task-id, tool-use-id
  ├─ status (completed/failed/killed)
  ├─ result (最终消息)
  ├─ usage (token 使用)
  └─ worktree (如有变更的 worktree 路径)
```

### 5.7 Agent 记忆系统

Agent 有独立的持久化记忆，跨会话保留：

```
记忆范围:
  ├─ User scope:    ~/.claude/agent-memory/         (跨项目共享)
  ├─ Project scope:  .claude/agent-memory/           (项目级，可提交 VCS)
  └─ Local scope:    .claude/agent-memory-local/     (本地私有，不提交)
```

### 5.8 Worktree 生命周期

```
创建: AgentTool.tsx 中，在 agent 运行前
  └─ .claude/worktrees/agent-XXXXXXXX/

运行: agent 所有文件操作都在 worktree 中

清理:
  ├─ 无变更 → 删除 worktree 和 branch
  ├─ 有变更 → 保留 worktree，返回路径和 branch 名给用户
  └─ Hook-based → 始终保留（无法检测变更）
```

---

## 6. 设计哲学总结

通过分析整个 Harness，可以提炼出以下核心设计原则：

### 原则 1：缓存即性能

**一切设计都围绕 prompt cache 优化**。从系统提示词的 boundary 分割、消息的不可变性（只追加不修改）、Beta header 的 sticky latching、到 Fork Agent 的字节级一致性复用——Claude Code 极度重视减少 `cache_creation` tokens，最大化 `cache_read` tokens。

> 一个消息的修改 = cache miss = 数万 tokens 的重新处理成本

### 原则 2：故障安全 (Fail-Closed)

安全系统的默认行为是**拒绝**。
- 未知的 AST 节点类型 → 拒绝
- 未知的环境变量 → 不白名单
- 未识别的命令模式 → 询问用户

这确保了新的攻击向量无法绕过现有检查。安全性不是通过"检测危险"实现的，而是通过"只放行已知安全的"实现的。

### 原则 3：错误扣留与恢复

不立即暴露错误，先尝试恢复。
- prompt_too_long → 压缩后重试
- max_output_tokens → 升级限制后重试
- 模型故障 → 降级到备用模型

只有所有恢复手段耗尽，才向用户报错。用户看到的是一个"自愈"的系统。

### 原则 4：渐进式上下文压缩

不是一次性截断，而是**四层递进**：
1. Micro-compact（清除旧工具输出）
2. Session memory compact（用结构化记忆替代历史）
3. Full compact（LLM 生成摘要 + 智能恢复关键上下文）
4. Reactive compact（运行时兜底）

每一层都尽量保留最有价值的信息。

### 原则 5：隔离即安全

子 Agent 通过**多维隔离**保证安全：工具过滤、权限模式、Git worktree、CWD 隔离、MCP 服务器隔离。每个维度独立工作，组合提供纵深防御。

### 原则 6：异步与流式优先

从 Generator-based 的查询循环、流式工具执行器、后台 Agent 任务、到异步 memory prefetch——系统在每个层面都避免阻塞，最大化并行度和响应速度。

### 原则 7：状态外部化

所有状态都外部化到文件系统（transcript、tool results、file history、memory）。这使得：
- 长对话可以跨 context window 存活
- 崩溃后可以恢复
- 子 Agent 可以共享状态
- 调试时可以检查中间状态

---

## 附录 A：关键文件索引

### 入口与引导

| 文件 | 行数 | 职责 |
|-----|------|------|
| `src/entrypoints/cli.tsx` | ~100 | 真正入口，注入 polyfill |
| `src/main.tsx` | 4,683 | Commander.js CLI，参数解析，服务初始化 |
| `src/entrypoints/init.ts` | — | 一次性初始化 |

### 核心循环

| 文件 | 行数 | 职责 |
|-----|------|------|
| `src/query.ts` | 1,732 | 主查询循环（generator） |
| `src/QueryEngine.ts` | 1,320 | 高层编排（SDK/headless 入口） |
| `src/services/api/claude.ts` | 3,420 | API 客户端，流式处理 |

### 提示词系统

| 文件 | 职责 |
|-----|------|
| `src/constants/prompts.ts` | 系统提示词组装（914 行） |
| `src/constants/systemPromptSections.ts` | Section 缓存/失效机制 |
| `src/context.ts` | Git 状态 + CLAUDE.md + 日期上下文 |
| `src/utils/claudemd.ts` | CLAUDE.md 发现与加载 |
| `src/utils/systemPrompt.ts` | 提示词优先级组装 |
| `src/utils/api.ts` | Cache control 切分逻辑 |

### 上下文管理

| 文件 | 职责 |
|-----|------|
| `src/services/compact/autoCompact.ts` | 自动压缩触发逻辑 |
| `src/services/compact/compact.ts` | 完整压缩流程 |
| `src/services/compact/microCompact.ts` | 轻量级工具输出清理 |
| `src/services/compact/sessionMemoryCompact.ts` | 会话记忆压缩 |
| `src/utils/toolResultStorage.ts` | 大型输出持久化 |
| `src/utils/fileStateCache.ts` | 文件状态 LRU 缓存 |
| `src/utils/fileHistory.ts` | 文件修改快照 |
| `src/memdir/memdir.ts` | 记忆目录系统 |

### 权限与安全

| 文件 | 职责 |
|-----|------|
| `src/types/permissions.ts` | 权限类型定义 |
| `src/utils/permissions/permissions.ts` | 权限决策引擎 |
| `src/utils/permissions/dangerousPatterns.ts` | 危险命令模式列表 |
| `src/utils/bash/ast.ts` | AST 级命令解析与安全分析 |
| `src/tools/BashTool/destructiveCommandWarning.ts` | 破坏性操作警告 |
| `src/utils/permissions/bashClassifier.ts` | Auto 模式分类器 |
| `src/hooks/toolPermission/` | 工具权限 hooks |

### Agent 系统

| 文件 | 职责 |
|-----|------|
| `src/tools/AgentTool/AgentTool.tsx` | Agent 入口，spawn 逻辑 |
| `src/tools/AgentTool/runAgent.ts` | Agent 执行引擎 |
| `src/tools/AgentTool/builtInAgents.ts` | 内置 Agent 注册 |
| `src/tools/AgentTool/built-in/*.ts` | 各内置 Agent 定义 |
| `src/tools/AgentTool/forkSubagent.ts` | Fork 子 Agent 实现 |
| `src/tools/AgentTool/agentToolUtils.ts` | 工具过滤与结果处理 |
| `src/tools/AgentTool/agentMemory.ts` | Agent 持久化记忆 |
| `src/tools/AgentTool/loadAgentsDir.ts` | 自定义 Agent 加载 |
| `src/tasks/LocalAgentTask/LocalAgentTask.tsx` | 异步任务管理 |

### UI 层

| 文件 | 职责 |
|-----|------|
| `src/screens/REPL.tsx` | 交互式 REPL（5,009 行） |
| `src/Tool.ts` | 工具接口定义（792 行） |
| `src/tools.ts` | 工具注册中心（389 行） |
| `src/ink/` | 自定义 Ink 终端 UI 框架 |
| `src/components/` | 80+ 业务组件 |
| `src/hooks/` | 80+ React hooks |

---

> **持续更新说明**：本文档将随着对源码的深入研究持续补充。下一步计划研究的方向：
> - [ ] 工具描述的 prompt engineering（每个工具如何描述自己）
> - [ ] MCP 集成架构
> - [ ] Skill 系统的实现
> - [ ] IDE 集成桥接（Bridge 系统）
> - [ ] 遥测与 A/B 测试（GrowthBook 集成）
> - [ ] 流式 UI 渲染优化（Ink 框架）
> - [ ] Coordinator 模式与 Swarm 团队协作
