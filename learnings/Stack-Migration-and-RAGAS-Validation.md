# 技术选型决策记录:后端全栈迁移 + RAGAS 质量验证

> 面向面试准备:记录 KnowHive 从「Electron + Python 后端」迁移到「Tauri + TS/bun 全栈」的完整决策过程、踩过的坑、以及用 RAGAS 量化验证「迁移没有伤害 RAG 质量」的结果。配套文档:[Electron-vs-Tauri.md](./Electron-vs-Tauri.md)。

---

## 0. TL;DR(电梯版)

> "我把一个本地 RAG 桌面应用从 Electron+Python 迁到了 Tauri+TS/bun 全栈。关键不是'哪个更好'——是**在'学习项目'这个定位下,每个选型都有可辩护的理由**。最有说服力的一点:我没有拍脑袋说'迁移没问题',而是**用 RAGAS 量化验证**——结果 TS 栈的检索质量不但没退化,反而因为换到 SQLite 后能做**向量+FTS5 混合检索(RRF 融合)**,把 context_recall 从 0.34 拉到 0.71,**不用 reranker 就追平了原来带 reranker 的 Python 基线**。"

---

## 1. 起点与终点

**起点:** Electron(React)壳 + Python FastAPI sidecar(LangGraph + ChromaDB + sentence-transformers + CrossEncoder reranker)

**终点:** Tauri(Rust 壳)+ TS/bun sidecar(Hono)+ Ollama + SQLite(bun:sqlite + FTS5 + 暴力 KNN)+ Vercel AI SDK

**项目定位(决定性前提):** KnowHive 主要是**学习 / 作品集 / 面试项目**,不是冲用户量的产品。这个定位翻转了很多判断——"统一栈重写"对产品是零用户价值的负债,但对学习是高价值;踩到的坑都是面试素材。

---

## 2. 决策链条(以及每一步的理由)

### 2.1 外壳:Electron → Tauri
详见 [Electron-vs-Tauri.md](./Electron-vs-Tauri.md)。一句话:原始打分打平,但按本项目权重(内存/体积/安全高权重,渲染一致性/生态因 UI 简单而低权重)Tauri 胜出;且换壳与换后端解耦,sidecar 生命周期语言无关。

### 2.2 大分叉:保留 Python 后端 vs 全 TS 重写
- 一开始理性结论是**保留 Python**(重写是价值中性的横向迁移 + 有真实风险)。
- 但反复摇摆,根因被点破:**驱动力是"想用 bun + 统一 TS 栈"的学习诉求**,而我一直用"用户价值"的尺子量,量错了。
- 定位确认为学习项目后 → **全 TS 重写有真实价值(给自己的)** → 拍板重写。

### 2.3 被否决的功能:per-KB LoRA 微调
- 设想:给每个知识库微调本地小模型,让它"记住"这个库的知识。
- **否决理由(理论 + 文献,arXiv 2312.05934《Fine-Tuning or Retrieval?》):**
  1. 微调注入**事实知识不可靠、更易幻觉**;RAG 才是注入事实的正确工具,而且我已经有 RAG。
  2. **操作错配**:知识库是动态的(Obsidian 同步天天变),LoRA 是批量快照,每改一条就过时;RAG 改一个 chunk 毫秒级重嵌入。
  3. 个人库数据量太小,微调易过拟合/灾难性遗忘。
- **关键认知:模型"知不知道"无关紧要——RAG 在推理时把相关内容喂给它(开卷考)。答得不好是检索问题,不是训练问题。**

### 2.4 推理引擎:保留 Ollama(否决 node-llama-cpp)
- 换 node-llama-cpp 的唯一刚需是「LoRA 运行时热插拔」(Ollama 不支持,见 issue #9548)。LoRA 一砍,这个理由消失。
- Ollama 提供成熟的模型管理 + 进程隔离,保留它零风险。
- **认知:LLM 推理的重计算在 Ollama/云,不在后端语言里——所以生成质量与后端是 Python 还是 TS 无关。**

### 2.5 向量库:ChromaDB → SQLite(暴力 KNN + FTS5)
- **为什么必须换 Chroma:** Chroma 的嵌入式模式是 **Python 独占**;TS 里用它就得起独立 Chroma server 进程,违背"自包含"。换库是"走 TS"的连带结果。
- **TS 本地向量库候选**(2026):Orama(纯 JS,hybrid 内置)、LanceDB(Rust 核,ANN,但原生插件 + bun 打包风险)、sqlite-vec(SQLite 扩展)、纯 SQLite 暴力。
- **踩坑:sqlite-vec 在 macOS 撞墙** —— Apple 系统 SQLite 禁用动态扩展加载;dev 能靠 Homebrew libsqlite3 顶,但发行不能依赖。
- **最终选:全 SQLite(embedding 存 BLOB + JS 暴力 cosine KNN + FTS5)**,理由:单存储/事务性/崩溃安全/零原生依赖;个人库规模暴力检索毫秒级;检索层抽象成 `VectorIndex` 接口,规模大了可无痛换 LanceDB。

### 2.6 KNN vs ANN(为什么敢用暴力)
- **KNN(精确暴力)**:逐个算相似度,O(n),永远正确。**ANN(近似)**:靠 HNSW/IVF-PQ 索引,亚线性,但近似(~95-99% 召回)。
- ChromaDB 用 HNSW(ANN);我用精确 KNN。
- **判断:个人库(几千~几万 chunk)暴力只要几毫秒且永远准,ANN 的"近似"trade-off 买不到我需要的东西。只有 10 万+ 才需要 ANN。**——展示判断力 + 不过度工程。

### 2.7 前端流式:Vercel AI SDK `useChat`(v7)
- 后端用 `streamText` + `toUIMessageStreamResponse` 发 UI-message 流协议;前端 `useChat` 消费。
- **踩坑:** AI SDK v7 的 provider 需要 `zod/v4` 子路径;从 /tmp 跑 spike 时 bare import 落到 bun 全局缓存导致解析失败——在 server 目录内跑正常。`convertToModelMessages` 在 v7 返回空对象,改为手动映射 UIMessage→`{role,content}` 绕过。

---

## 3. 最终架构

```
Tauri 壳 (Rust) — 窗口 + spawn/守护 bun sidecar
 └─ TS/bun sidecar (Hono)
      ├─ 存储:bun:sqlite(单文件)+ FTS5 + embedding BLOB
      ├─ 检索:VectorIndex 接口 → BruteForceIndex(cosine KNN)⊕ FTS5,RRF 融合
      ├─ embedding:HTTP 调 Ollama(english→nomic-embed / mixed→bge-m3)
      ├─ 生成:AI SDK streamText → Ollama /v1(OpenAI 兼容),UI-message 流式
      └─ (dev/CI 工具,不打包)Python RAGAS eval
```

工程质量:纯逻辑模块全部 TDD(bun test,35 测试绿:cosine/KNN/BLOB/RRF/frontmatter/chunker/prompt);检索、embedding、chat 均有真实 Ollama 的 e2e 验证。

---

## 4. RAGAS 质量验证(核心结果)

**方法:** 同一数据集(20 题中文 LeetCode 知识库)、同一 grader(gpt-4o-mini)、同一语料。复用 Python 的 RAGAS harness,写适配器让它打 TS sidecar 的 `/search`(contexts)+ `/chat`(answer)。

| 指标 | **TS(无 rerank)** | Python 无 rerank | Python **有 rerank**(旧基线) |
|---|---|---|---|
| faithfulness | **0.669** | 0.570 | 0.716 |
| answer_relevancy | **0.687** | 0.608 | 0.832 |
| context_precision | **0.835** | 0.750 | 0.818 |
| context_recall | **0.706** | 0.338 | 0.674 |

**结论:**
1. **对公平基线(都无 rerank):TS 四项全胜**,context_recall **0.34→0.71 翻倍**。→ 换语言 + 换向量库**本身无退化,反而全面提升**。
2. **TS 无 rerank 已在检索质量(precision + recall)上追平/超过 Python「有 rerank」基线** —— 混合检索(向量+FTS5+RRF)做到了原来要 reranker 才有的效果。
3. **根因(最强面试点):** Python 无 rerank 是**纯向量**(Chroma),recall 只有 0.34;换到 SQLite 后能做 **FTS5 关键词 + RRF 融合**,把向量漏掉的关键词命中捞回来 → 0.71。**"换向量库"换来的 hybrid 能力,是这个提升的来源。**

**诚实 caveat:**
- TS 只在 faithfulness/answer_relevancy 上略低于**有 rerank** 的基线——这俩是生成质量指标,受生成模型影响,而旧基线**没记录用的哪个 Ollama 模型**;TS 配的是 llama3.2。接上 reranker(喂更好上下文)后理论上会补。
- n=20 有噪声,但 recall 0.34→0.71 远超噪声。
- embedding 严格说不是"完全没变":同一模型 bge-m3,但从 sentence-transformers 全精度换成 Ollama GGUF 量化(语义≈,数值略异)。

---

## 5. 面试要点速查

- **"迁移了怎么证明没退化?"** → 不靠嘴,靠 RAGAS 同基准对比;还发现换 SQLite 带来的 hybrid 检索让 recall 翻倍。
- **"为什么不用 ChromaDB?"** → 嵌入式是 Python 独占,TS 用它得起独立进程,违背自包含。
- **"为什么敢用暴力 KNN 不用向量数据库?"** → 评估了规模,几千~几万 chunk 暴力毫秒级且永远准,HNSW 是 overkill;接口抽象,规模大了可换 LanceDB。
- **"为什么不给知识库做微调?"** → RAG 和微调解决不同问题;微调注入事实不可靠且与动态库错配;RAG 是开卷考,模型不需要"记住"。
- **"reranker 呢?"** → hybrid 已追平 reranker 基线,reranker 降级为锦上添花;要加有两条路:transformers.js ONNX cross-encoder(正统,需验 bun 打包原生插件)或 LLM-as-reranker(零依赖,立即可用)。

---

## 6. Phase E 复评:LLM-as-reranker(2026-07-04)

Phase D 完成后,Phase E 第一步选了 **LLM-as-reranker**(hybrid 粗召回 20 候选 → llama3.2 单次 listwise 调用精排 → top-5,零新依赖,解析失败 fail-open),再跑同一 RAGAS 基准:

| 指标 | **TS + LLM rerank** | TS 无rerank | Python CrossEncoder(旧完整栈) |
|---|---|---|---|
| faithfulness | **0.696** | 0.668 | 0.716 |
| answer_relevancy | **0.805** | 0.687 | 0.832 |
| context_precision | 0.829 | 0.835 | 0.818 |
| context_recall | 0.660 | 0.706 | 0.674 |

**读法:**
1. **answer_relevancy +0.12(0.687→0.805)是 rerank 的主要收益**,faithfulness +0.03——精排把真正相关的 chunk 排进 top-5,生成质量随之上来。
2. **与 Python CrossEncoder 完整栈基本打平**(-0.02/-0.03/+0.01/-0.01,n=20 噪声内)——一个 prompt 就追平了专训 cross-encoder,不需要任何原生依赖。
3. **recall 略降(0.706→0.660)是 rerank 的已知代价**:从 20 候选里只保 5 个,精排偶尔会丢掉 hybrid top-5 里本来命中的 chunk。Python CrossEncoder 也一样(0.674)。
4. 代价是延迟:每次查询多一轮本地 LLM 调用(约 2-8s)。

**面试点:** "reranker 我做了两步走——先用 LLM-as-reranker(零依赖)拿到量化收益证明,数据显示它已追平原 CrossEncoder 基线;transformers.js/ONNX 的原生方案只有在延迟不可接受时才值得引入,那是唯一一个会威胁 bun 单二进制打包的依赖。"

## 7. 尚未完成 / 后续

- 预检索策略(query rewrite / HyDE / multi-query)分层加回
- Phase E 第二步(可选):transformers.js cross-encoder spike——仅当 LLM rerank 延迟不可接受;先验 bun build --compile 能否带 onnxruntime
- Phase F:`bun build --compile` 单二进制 + Tauri 打包 + 清理 Python 运行时/Electron 残留
