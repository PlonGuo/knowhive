# Agentic Loop vs 单趟 RAG：评估闸判决 — Phase G Task 7

**日期**: 2026-07-15 · **模型**: llama3.2 (3B) via Ollama · **grader**: gpt-4o-mini
**判决**: **闸未过 —— `chat_mode` 默认保持 `single`，agentic 作为用户可选**（按 plan 预设规则执行）

## 目的

Phase G 把 `/chat` 升级为 tool-use loop 后，用数据回答：agentic 模式在它该赢的地方
（多跳问题）赢了吗？在它不该输的地方（单跳回归）输了吗？4 个 arm：
{单跳20题, 多跳10题} × {single, agentic}，全部同 session 同语料同配置（mixed embedding +
cross-encoder rerank）配对对比。

## 结果

### 单跳 20 题（回归闸：agentic 各指标 ≥ single − 0.05）

| 指标 | single | agentic | Δ | 闸 |
|---|---|---|---|---|
| faithfulness | 0.6415 | 0.5996 | −0.042 | ✅ 勉强 |
| answer_relevancy | 0.8524 | **0.6499** | **−0.203** | ❌ |
| context_precision | 0.9148 | 0.9095 | −0.005 | ✅ |
| context_recall | 0.7575 | 0.8275 | **+0.070** | ✅ |
| 中位延迟 | ~5.5s | ~7s（**尾部 920s/1042s**） | — | 记录 |

### 多跳 10 题（硬闸 source_recall > 基线；软闸 ≥ −0.05）

| 指标 | single | agentic | Δ | 闸 |
|---|---|---|---|---|
| **source_recall（硬闸）** | 0.7417 | **0.7417** | **0** | ❌ 持平非胜出 |
| faithfulness | 0.6866 | 0.7625 | +0.076 | ✅ |
| answer_relevancy | 0.8362 | **0.6200** | **−0.216** | ❌ |
| context_precision | 0.9887 | 0.9841 | ≈0 | ✅ |
| context_recall | 0.8833 | 0.8500 | −0.033 | ✅ |

### 行为数据

- 工具使用率：单跳 9/20（**本不需要却用了**），多跳 6/10
- 空答案 0/30、崩溃 0——loop 基础设施本身稳
- **失控尾部 2/30**：两个样本 15-17 分钟。根因：`stepCountIs(6)` 限步数**不限单步内
  调用数**——spike 发现的 40-连发模式在步内复活（一步并发大量 search → 每个都过
  cross-encoder rerank → 上下文膨胀 → 下一步更慢）

## 机制分析（为什么输）

1. **relevancy 崩是答案真变差，不是指标假象**：llama3.2 调完工具后倾向于复述/汇总工具
   输出而不是回答问题（e2e 观察到「最终答案是Dijkstra由于优先队列实现的计算复杂度（...）
   与区间DP和数位DP的状态设计差异主要在于...」这类把多主题搅在一起的漂移文本）
2. **source_recall 持平的含义**：预检索（hybrid+rerank, k=5）已经覆盖了大部分
   expected_sources；模型的 hop-2 检索没有捞回预检索漏掉的文件（漏掉的样本里模型
   要么没调工具、要么查询质量不足以命中）。**3B 模型的查询构造能力是瓶颈**
3. recall +0.07（单跳）证明工具确实带回了更多相关上下文——但小模型消化不了，反而稀释了答案

## 决策与后续

- ✅ `chat_mode` 默认 **保持 single**（不翻），Settings 里 Agent Mode 开关保留为可选
- ⏳ **云模型 arm 待跑**（计划 DeepSeek，OpenAI 兼容路径已就绪）：假设「瓶颈在模型不在
  harness」需要数据验证——DeepSeek/GPT 级模型的工具调用纪律和答案综合能力完全不同
- ⏳ 后续加固（下一轮 loop 优化时做）：**单步工具调用数上限** + **重复查询去重**
  （已见 query 直接返回提示），堵失控尾部
- ⏳ 多跳硬闸可能需要更难的数据集：当前 10 题里预检索已能覆盖太多，天花板被压低了
  （改进方向：问题涉及的笔记之间词面重叠更低）

## 顺带踩的坑（独立价值）

**Clash TUN 代理 + 无超时 HTTP 客户端 = 评估僵死**。agentic arm 的大 contexts payload
在代理隧道里连接静默死亡，而 openai `OpenAI()`、langchain `OpenAIEmbeddings()` 默认
**都没有超时**——进程 0% CPU 挂死 1 小时+，三次才定位齐（LLM client 修了还有 embeddings
client）。修复：两个 client 显式 `timeout=120, max_retries=5` + ragas `RunConfig(timeout=180,
max_workers=4)`。教训：**评估管线里的每一个网络客户端都必须有显式超时**，"侥幸通过"只是
payload 还不够大。

## 面试点

「我给 agentic loop 设了三条预注册的量化闸，结果它没过——单跳 relevancy −0.20，多跳
source_recall 持平。所以默认值没翻，agentic 留作可选。这个『否定结果』比正结果更有价值：
它证明了 3B 本地模型的瓶颈在答案综合而非检索（recall 是涨的），也把『换云模型』从拍脑袋
变成了一个有基线数据的可验证假设。闸的意义就是让你在数据面前没有借口。」
