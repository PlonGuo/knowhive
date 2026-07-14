# Spike: llama3.2 (3B) 经 Ollama /v1 的 tool-call 可靠性 — Phase G Task 0 闸

**日期**: 2026-07-14 · **闸**: 合法 tool-call 率 ≥70% 则 llama3.2 走完整 agentic loop
**结论**: **通过（83% 发起 / 80% 干净），llama3.2 走完整 loop，无需降级路径**

## 目的

Phase G 把 `/chat` 从单趟 RAG 升级为 AI SDK v7 多步 tool-use loop。唯一高风险项：
本地默认模型 llama3.2 (3B) 能否可靠地发起结构化工具调用——小模型 tool-call 常见故障是
根本不调、参数 JSON 畸形、或流式协议崩。按项目惯例（E2/F 同款），实现前先 spike 定生死。

## 方法

`streamText` + 假 `search_knowledge` 工具（zod 单字段 schema）+ `stopWhen: stepCountIs(4)`，
系统提示词模拟混合模式（预注入一段上下文 + 指示不足时调工具）。3 个多跳问题 × 10 次 = 30 runs，
经 `createOpenAICompatible` 打 Ollama 0.30.11 `/v1`。逐 run 记录：步数、工具调用数、
错误 chunk、最终文本长度、延迟。

## 结果（30 runs）

| 指标 | 值 |
|---|---|
| tool-call 发起率 | **25/30 (83%)** |
| 干净率（发起 + 无 invalid/错误） | **24/30 (80%)** |
| 多步（≥2 step） | 25/30 |
| 产出最终文本 | 29/30 |
| 平均延迟 | 3.8s（正常 runs 1.5–4.5s） |
| 参数 JSON 畸形 | **0/30** |

### 两个值得记住的失败样本

1. **失控连发（1/30）**：一个 run 在第二步狂发 **40 个工具调用**（含幻觉工具名 → 40 个
   tool-error chunk），耗时 48s。→ 印证实现层三道防线的必要性：`stepCountIs(6)` 步数上限、
   `prepareStep` 末步物理禁工具、工具输出紧凑化。
2. **调了工具但最终无文本（1/30）**：第二步 finish 但 text 为空。低频（3%），先记录，
   评估闸（Task 7）会量化其对指标的影响；若成为问题再加空文本兜底重试。

另外 5/30 没调工具直接回答——**混合模式的设计意义所在**：这些 run 的质量 = 现状单趟 RAG，
不是零上下文幻觉。

## 顺带确认的事实

- 流式 tool call 经 Ollama OpenAI-compat `/v1` 全程走通（AI SDK v7 默认流式），无协议层问题
- 参数 schema 越小越稳：单字段 `{query: string}` 30 次零畸形——支持「k 不暴露给模型」的设计
- **num_ctx 未能按计划 A/B**：Ollama 的 `/v1`（OpenAI-compat）不接受 per-request `num_ctx`，
  默认上下文由服务端 `OLLAMA_CONTEXT_LENGTH` 决定。对策已内建：工具输出紧凑（chunk 只回
  3 字段）、read_note 截断 6000 chars、list_notes 截断 200 条

## 决策

- llama3.2 走完整 agentic loop（混合模式），**不启用**「ollama 小模型静默单趟」降级路径
- Task 7 评估闸按原计划对 llama3.2 生效
- 失控连发风险由实现层防线覆盖（步数上限 + 末步禁工具），不额外加机制

**面试点**: 「上 agentic loop 前先花 20 分钟 spike 掉唯一不可控变量——3B 模型的 tool-call
可靠性。30 次量化跑出 83%/80%，同时白捡两个真实失败模式（40 连发失控、空文本收尾），
这两个样本直接决定了实现里 stepCountIs + prepareStep 末步禁工具的双保险设计。」
