# KnowHive 简历 Bullets（AI Agent 岗 · 中文版）

> 投递方向:AI Agent 岗。以下每条都对应仓库里的 learnings + commit,面试可翻出证据链。
> 英文版对照见本文件末尾链接的各 learnings 文档;数字全部来自真实评估,不吹不编。

**KnowHive** — 本地优先的 RAG + Agent 知识库 · *Tauri v2 (Rust) + TypeScript/bun, Vercel AI SDK v7*

---

## 完整 6 条(按 Agent 岗相关度排序)

**1. 自研 Agentic 工具循环(不套框架)。** 在 AI SDK 上手写了 ReAct 式 agent——对知识库的
search/read/write 工具、有界多步循环(`stepCountIs` + 末步禁用工具的结构性兜底),小本地模型
不调工具时优雅降级为单趟 RAG。刻意把 harness 做薄(不上 LangGraph、不照搬 Claude Code 那种
带外事件注入)——按业务场景裁剪,而不是无脑堆架构。

**2. 评估驱动决策,敢于交付"否定结果"。** 做了预注册 A/B(单趟 vs agentic),用 RAGAS +
自定义确定性指标 `source_recall`,数据集是自建的多跳题集。结果 agentic 默认**没过**质量闸
(多跳答案相关性在 llama3.2 **和** DeepSeek 上**都**退化),于是保留单趟为默认,并用 4-arm
云模型对比把瓶颈定位到"答案综合"而非"检索"。

**3. 跨会话长期记忆,用 A/B 证明有效。** 设计并实现了基于蒸馏的长期记忆(语义/程序性/情景
三类),含水位线压缩、向量召回、LRU/TTL 淘汰。量化它的价值:用户专属问题的答案命中率
**0% → 100%**;还加了 OFF 臂自检,自动标出 2 条"泄漏"测试项,而不是把分数灌高。

**4. 提示注入红队 + 防御。** 自建 canary 式间接注入靶场(5 类攻击);用 spotlighting +
蒸馏防护把沦陷率从 **单跳 0.40 → 0.27、agentic 0.13 → 0.00**,以 fail-closed 写权限 + 人工
审批(HITL)兜底。还抓出一个后续延迟优化悄悄引入的**安全回退**,在合并前修掉。

**5. LLM 成本与延迟系统优化。** 重构对话请求让 system 前缀稳定可缓存,把 DeepSeek prompt-cache
命中率在多轮场景从 **0% → 22%**(输入成本约降 20%);做了 TTFT 延迟瀑布埋点,定位到
cross-encoder 精排占延迟 **46%**,并消除一次冗余的 query embedding(recall 段 **156ms → 1ms**)。

**6. 混合检索 + 经验证的重写。** 向量 KNN ⊕ SQLite FTS5 用 RRF 融合 + 进程内 cross-encoder
精排(int8 ONNX / transformers.js,无 Python 服务);用 RAGAS 质量闸把整个后端从 Python 重写为
TypeScript,四项指标全面超过原版。

---

## 只放 4 条(单页简历,Agent 岗优先级)

留 **1(agent 循环)+ 3(记忆)+ 2(评估)+ 4(红队)**——正好覆盖 Agent 岗最看重的四点:
自研 agent、记忆系统、评估严谨性、安全,且都带真实数字。第 5、6 条是加分的 systems/RAG 底座,
篇幅够就加。

---

## 证据链(面试深挖时对应文档)

- 1 → agentTools.ts / chatRoutes.ts + [HARNESS_DEEP_DIVE](HARNESS_DEEP_DIVE.md)
- 2 → [Agentic-vs-SingleShot](Agentic-vs-SingleShot.md)
- 3 → [Memory-Eval](Memory-Eval.md) + [Memory-System-Design](Memory-System-Design.md)
- 4 → [Prompt-Injection-Redteam](Prompt-Injection-Redteam.md)
- 5 → [Prompt-Cache](Prompt-Cache.md) + [Latency-Waterfall](Latency-Waterfall.md)
- 6 → [Stack-Migration-and-RAGAS-Validation](Stack-Migration-and-RAGAS-Validation.md) + [Reranker-K-Sweep](Reranker-K-Sweep.md)

> 面试准备提醒:这些 bullet 值钱是因为背后有证据链,但前提是你把每份 learnings 读透——
> 面试会往里钻(例:"为什么多跳 relevancy 换强模型还崩?")。这正是"边优化边学会整个项目"的下一步。
