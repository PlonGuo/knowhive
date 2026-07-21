# Learnings Index

KnowHive 的决策记录、实验数据与面试材料。按用途分四类：

## career/ — 简历与面试准备

| 文档 | 内容 |
|---|---|
| [Resume-Bullets-CN](career/Resume-Bullets-CN.md) | AI Agent 岗中文简历 bullets，每条对应仓库内的证据链 |
| [Interview-QA-CN](career/Interview-QA-CN.md) | 面试深挖问答库：每条 bullet 可能被追问的问题 + 答案 |
| [Interview-Deepdive-CN](career/Interview-Deepdive-CN.md) | 两个杀手锏点的白板级深度讲稿（缓存×安全回退、agentic 否定结果） |
| [Learning](career/Learning.md) | RAG 系统完整学习指南：从底层原理到工程实现 |

## evals/ — 评估与实验记录（有数据）

| 文档 | 一句话结论 |
|---|---|
| [Prompt-Cache](evals/Prompt-Cache.md) | volatile context 挪出稳定前缀，多轮缓存命中 0% → 22%（Tier 1-3） |
| [Prompt-Injection-Redteam](evals/Prompt-Injection-Redteam.md) | 间接注入红队：agentic 0.13→0，single 0.40→0.27；兜底靠权限层 + HITL |
| [Memory-Eval](evals/Memory-Eval.md) | 跨会话记忆 A/B：用户专属问题命中率 0% → 100% |
| [Latency-Waterfall](evals/Latency-Waterfall.md) | TTFT 拆解：rerank 占 46%；消除冗余 embed，recall 156ms → 1ms |
| [Agentic-vs-SingleShot](evals/Agentic-vs-SingleShot.md) | 评估闸未过：3B 模型下 agentic 检索增益不敌综合退化，默认保持 single |
| [Llama32-Tool-Call-Spike](evals/Llama32-Tool-Call-Spike.md) | llama3.2 tool-call 可靠性 83%/80%，过 70% 闸 |
| [Reranker-K-Sweep](evals/Reranker-K-Sweep.md) | recall 由 k 决定而非 rerank；coverage prompt 转正 |

## decisions/ — 架构与选型决策

| 文档 | 决策 |
|---|---|
| [Electron-vs-Tauri](decisions/Electron-vs-Tauri.md) | 桌面外壳选型：加权打分后迁移 Tauri |
| [Stack-Migration-and-RAGAS-Validation](decisions/Stack-Migration-and-RAGAS-Validation.md) | Python → TS/bun 全栈迁移 + RAGAS 验证迁移未伤 RAG 质量 |
| [Bun-Compile-Native-Deps-Spike](decisions/Bun-Compile-Native-Deps-Spike.md) | bun 单二进制 × 原生 ML 依赖：可行但选择不用（trade-off 记录） |

## design/ — 系统设计与参考分析

| 文档 | 内容 |
|---|---|
| [Memory-System-Design](design/Memory-System-Design.md) | Memory 系统 M1+M2：持久化、水位线压缩、episodic/semantic 蒸馏 |
| [HARNESS_DEEP_DIVE](design/HARNESS_DEEP_DIVE.md) | Claude Code harness 逆向拆解（Phase G agentic loop 的参考） |

另：[CONTRIBUTING.md](CONTRIBUTING.md)（开发环境搭建，按惯例应放仓库根目录）。
