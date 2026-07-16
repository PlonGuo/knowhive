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
- ✅ **云模型 arm 已跑（DeepSeek，2026-07-16）**：见下文「云模型验证」——假设部分成立
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

## 云模型验证（DeepSeek，2026-07-16）

同语料同 4-arm 用 `deepseek-chat` 复跑（chat 走 openai-compatible，embedding 仍走本地
Ollama——见 `ollama_base_url` split 修复 bfbadc7），验证「瓶颈在模型不在 harness」。

### 单跳 20 题（single → agentic）

| 指标 | single | agentic | Δ | 对比 llama3.2 |
|---|---|---|---|---|
| faithfulness | 0.828 | **0.902** | **+0.074** | llama3.2 −0.042 |
| answer_relevancy | 0.767 | **0.823** | **+0.056** | llama3.2 **−0.203** |
| context_precision | 0.920 | 0.904 | −0.016 | ≈ |
| context_recall | 0.768 | 0.830 | +0.062 | 都涨 |

### 多跳 10 题（single → agentic）

| 指标 | single | agentic | Δ | 对比 llama3.2 |
|---|---|---|---|---|
| **source_recall（硬闸）** | 0.742 | **0.808** | **+0.066** | llama3.2 持平（0） |
| faithfulness | 0.891 | 0.850 | −0.041 | llama3.2 +0.076 |
| answer_relevancy | 0.865 | **0.604** | **−0.261** | llama3.2 −0.216（**都崩**） |
| context_recall | 0.850 | 0.900 | +0.050 | ≈ |

### 判决：假设「部分成立」

1. **单跳 relevancy 反转 = harness 无罪**。llama3.2 单跳 agentic relevancy 崩 −0.20，
   DeepSeek 同路径 **涨 +0.056**（faith 也 +0.074）。同一套工具层、同一套 prompt，换个
   有工具纪律的模型就从「自伤」变「增益」——**崩溃是 3B 模型的答案综合能力问题，不是
   loop 设计问题**。这是原假设最硬的一块证据。
2. **多跳硬闸赢了**。source_recall 0.742→0.808（llama3.2 只持平）。agentic 的价值主张
   （多跳时二次检索捞回预检索漏掉的文件）**被有能力的模型兑现了**——DeepSeek 的 hop-2
   查询构造得动，llama3.2 构造不动。
3. **但多跳 relevancy 仍崩（−0.261），两个模型都崩**。这条最诚实也最反直觉：换强模型没
   救回它。说明多跳 agentic 的 relevancy 掉**不是纯小模型 artifact**——工具带回更多上下文
   后，答案变长/发散，跟单一问题的贴合度被稀释（context_recall 反而 +0.05 佐证「捞得更全
   但答得更散」）。可能掺了 grader 对长答案的惩罚。**未完全解释，留作 open question**。

**结论**：换默认值的决定不变（多跳 relevancy 软闸对 DeepSeek 仍不过）。但假设从「拍脑袋」
落成「有 8-arm 数据的分层结论」：**检索层和单跳，模型是瓶颈；多跳答案综合，harness 也有份**。

## 面试点

「我给 agentic loop 设了三条预注册的量化闸，结果它没过——单跳 relevancy −0.20，多跳
source_recall 持平。所以默认值没翻，agentic 留作可选。这个『否定结果』比正结果更有价值：
它证明了 3B 本地模型的瓶颈在答案综合而非检索（recall 是涨的），也把『换云模型』从拍脑袋
变成了一个有基线数据的可验证假设。闸的意义就是让你在数据面前没有借口。」

「然后我真去跑了 DeepSeek 那一 arm 验证这个假设——单跳 relevancy 从 llama3.2 的 −0.20
反转成 +0.06，多跳 source_recall 从持平变成 +0.07 胜出，证明检索层和单跳确实是模型瓶颈。
但多跳 relevancy 换强模型还是崩 −0.26，两个模型都崩——所以我没把结论一刀切成『都是模型的
锅』，而是分层：检索是模型问题，多跳答案综合 harness 也有份，这块我标成了未解问题。能区分
『我的假设被证实的部分』和『被证伪/存疑的部分』，比一个漂亮的单结论更重要。」
