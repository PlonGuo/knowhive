# KnowHive 简历成品版（中文 · AI Agent 岗）

> 可直接粘贴进简历"项目经历"板块。数字全部来自 `backend/eval_results/`、`backend/redteam_results/`
> 与 `learnings/evals/` 的真实评估，出处见 [Resume-Bullets-CN.md](Resume-Bullets-CN.md) 证据链。
> 单页用 4 条版；篇幅富余用 6 条版。

---

## 抬头

**KnowHive — 本地优先的 RAG + Agent 个人知识库**（个人项目）
技术栈：Tauri v2 (Rust) · TypeScript / Bun · Vercel AI SDK v7 · SQLite（向量 KNN ⊕ FTS5）· ONNX Runtime · DeepSeek / Ollama 双模型路径

---

## 单页版（4 条）

- **自研 agentic 工具循环**：基于 Vercel AI SDK 手写 ReAct 式 agent——知识库 search/read/write 工具、有界多步循环 + 末步禁用工具的结构性收口、写操作 fail-closed 权限 + 人工审批（HITL）；本地 3B 模型不调工具时优雅降级为单趟 RAG。
- **评估驱动决策，交付"否定结果"**：预注册 4-arm A/B（single vs agentic × 本地/云模型），RAGAS + 自研确定性指标 source_recall；证明检索有效（source_recall **+0.07**）但多跳答案综合在两种模型上均退化，据此将 agentic 保持为非默认——瓶颈定位到"答案综合"而非"检索"。
- **跨会话长期记忆，A/B 证明有效**：设计蒸馏式三类记忆（semantic / episodic / procedural）+ 水位线压缩 + 向量召回 + TTL 淘汰；用户专属问题答案命中率 **0% → 100%**，并以 OFF 臂自检剔除 2 条泄漏测试项，保证测的是记忆而非数据泄漏。
- **提示注入红队与防御**：自建 canary 式间接注入靶场（5 类攻击 × 32 篇笔记），spotlighting 缓解将沦陷率 single **0.40 → 0.27**、agentic **0.13 → 0**；后续缓存优化引入的安全退化（0.27→0.47）被红队回归在合并前捕获并修复归零。

## 完整版（6 条，篇幅富余时追加）

- **LLM 成本与延迟系统优化**：重构请求结构使 system 前缀跨轮字节级稳定，DeepSeek prompt cache 多轮命中率 **0% → 22%**（输入成本约 **−20%**，随会话变长持续上升）；TTFT 瀑布埋点定位 cross-encoder 精排占延迟 **46%**（860ms），消除一次冗余 query embedding，recall 段 **156ms → 1ms**。
- **混合检索与全栈重写**：向量 KNN ⊕ SQLite FTS5 以 RRF 融合 + 进程内 int8 ONNX cross-encoder 精排（无独立 Python 服务）；以 RAGAS 为质量闸将后端从 Python 全量重写为 TypeScript，四项指标全面超越原版（faithfulness 0.749 / relevancy 0.808 / precision 0.914 / recall 0.780）。

---

## 使用说明

- 每条结构：**做了什么（技术名词可被追问）→ 怎么验证 → 数字**。面试官从任何一个名词往下钻，对应的深挖材料在 [Interview-QA-CN.md](Interview-QA-CN.md)（按板块对应）和 [Interview-Deepdive-CN.md](Interview-Deepdive-CN.md)（第 4、5 条的白板讲稿）。
- 刻意不写的：代码行数 / 测试数量（无差异化价值）；"不套框架"的表述移到了面试口头层（简历上写事实，选型辩护留给对话）。
- 若目标岗位偏 RAG/检索而非 Agent，把第 6 条提进单页版换掉第 1 条。
