# /chat 延迟瀑布:TTFT 拆解 + 一个无悔优化 — Tier 2

**日期**: 2026-07-18 · **模型**: deepseek-chat(chat)+ nomic-embed(Ollama)+ bge-reranker-v2-m3 int8 ONNX
**结论**: **cross-encoder rerank 是 TTFT 最大头(860ms / 46%),hybrid search 可忽略(5ms);
发现并消除了一次冗余 embedding(同一 question 被 embed 两次),recall 段 156ms→1ms**

## 方法

env 门控埋点(`KNOWHIVE_TIMING=1`,默认关、零成本、不改行为):
- `chatRoutes` 把 `retrieveMs` / `preLlmMs` 折进 `messageMetadata`,探针从流里读。
- `index.ts` retrieve 内部再拆 `embed / search / rerank`(打日志)。
- 探针外部测 TTFT(首个 text-delta 时刻),`LLM首token = TTFT − preLlmMs`。
- 跑 stateless(无 recall)vs session(有 recall)隔离记忆成本。8 query 取中位数。

方法论要点:**先粗粒度找热点,再往热点里钻**——不是一上来给每行埋点。

## 瀑布(session 模式,中位数)

| 阶段 | 耗时 | 占 TTFT | 归属 |
|---|---|---|---|
| embed query (Ollama nomic) | 158 ms | 8% | 本地 |
| hybrid search (向量KNN ⊕ FTS5, RRF) | **5 ms** | 0.2% | 本地 |
| **cross-encoder rerank (bge int8 ONNX/CPU)** | **860 ms** | **46%** | 本地 |
| recall(第2次 embed 同一 question)+ assemble | 156 ms | 8% | 本地 |
| LLM first token (DeepSeek 网络+模型) | 667 ms | 36% | 远端 |
| **TTFT 合计** | **~1.86 s** | | |

## 发现 1:rerank 独占 46%,但不能乱砍(质量闸)

- bge-reranker int8 ONNX 在 CPU 上给 `RERANK_CANDIDATES` 个 (query,passage) 对打分,~860ms
  稳态(首调 1850ms 含 ONNX 冷加载)。
- hybrid search 才 5ms——**检索的召回层几乎免费,贵的是精排**。
- **不动它**:K-sweep(`Reranker-K-Sweep.md`)证明当前 k=5 + coverage 精排质量最优,砍候选数
  会掉 precision/recall。记录为未来可配置项:候选数可调 / rerank 改异步(先出无精排答案再回填)/
  换更小 reranker。这是典型的**延迟 vs 质量 tradeoff,要有数据才能动,不是拍脑袋提速**。

## 发现 2:同一 question 被 embed 两次 —— 无悔优化,已修

`retrieve` 给 query 做一次 embedding(158ms),`recallMemories` 又给**同一个 question** 做一次
(156ms)。纯冗余,零质量代价。

- **修法**:`/chat` 把 question **embed 一次**,vec 同时传给 `retrieve(query,k,vec)` 和
  `recallMemories(question,vec)`(deps 加可选 `queryVector` + `embedQuery`,agentTools 的工具查询
  文本不同,保持各自 embed)。
- **复测**:recall+assemble **156ms → 1ms**。本地流水线(retrieve+recall)非模型部分砍掉 ~13%。
- 为什么不是"并行 retrieve||recall":两者都打 Ollama 同一个 embedding 模型,大概率被串行化,
  并行省不到;**去重是无条件生效的,并行不是**。

## LLM first token(36%)不归我们管——除了缓存

DeepSeek 首 token 667ms 是网络+模型,单请求优化不了。但**多轮会话**里 Tier 1-3 的 prompt cache
重构(context 移出稳定前缀)让历史前缀命中缓存,间接降后续轮的 TTFT——见 `Prompt-Cache.md`。

## 面试点

「我给 /chat 做了 TTFT 瀑布,埋点是 env 门控的(默认零成本)。先粗拆四段找热点,发现 cross-encoder
精排占了 46%(860ms),而 hybrid 检索只有 5ms——所以'检索慢'的直觉是错的,慢在精排。精排我没
乱砍,因为 K-sweep 证明当前配置质量最优,我把它记成一个有数据支撑的延迟/质量 tradeoff。真正动手
的是另一个发现:同一个问题被 embed 了两次(检索一次、记忆召回一次),我改成 embed 一次两处复用,
recall 段 156ms 掉到 1ms。这就是我做性能的方式:先量再动,只砍无悔的,有 tradeoff 的先记录不硬上。」

## 复现

`KNOWHIVE_TIMING=1` 起 sidecar → `scratchpad/latency_probe.py`(或任意 /chat 探针读
`messageMetadata.timings`)。retrieve 内部拆分看 sidecar 日志 `[timing.retrieve]`。
