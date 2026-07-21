# KnowHive RAG 系统完整学习指南

> 面向面试准备：从底层原理到工程实现，彻底理解 RAG 系统的每一个环节。

---

## 目录

- [第一章：基础理论](#第一章基础理论)
  - [1.1 Transformer 架构](#11-transformer-架构)
  - [1.2 向量与相似度](#12-向量与相似度)
  - [1.3 语言模型基础](#13-语言模型基础)
- [第二章：Embedding（向量化）](#第二章embedding向量化)
  - [2.1 从 Word Embedding 到 Sentence Embedding](#21-从-word-embedding-到-sentence-embedding)
  - [2.2 Pooling 策略](#22-pooling-策略)
  - [2.3 对比学习训练细节](#23-对比学习contrastive-learning训练细节)
  - [2.4 bge-m3 的三种检索模式](#24-bge-m3-的三种检索模式)
  - [2.5 Embedding 的局限性](#25-embedding-的局限性)
- [第三章：Ingestion（数据入库）](#第三章ingestion数据入库)
  - [3.1 文件处理](#31-文件处理)
  - [3.2 分块策略（Chunking）](#32-分块策略chunking)
  - [3.3 去重与增量更新](#33-去重与增量更新)
  - [3.4 存储流程](#34-存储流程)
- [第四章：向量数据库（ChromaDB）](#第四章向量数据库chromadb)
  - [4.1 向量索引与 ANN](#41-向量索引与-ann)
  - [4.2 ChromaDB 架构](#42-chromadb-架构)
- [第五章：Retrieval（检索）](#第五章retrieval检索)
  - [5.1 基础检索流程](#51-基础检索流程)
  - [5.2 Pre-Retrieval 策略](#52-pre-retrieval-策略)
  - [5.3 Post-Retrieval：Reranking](#53-post-retrieval-reranking)
- [第六章：Generation（生成）](#第六章generation生成)
  - [6.1 Prompt Engineering](#61-prompt-engineering)
  - [6.2 LLM 调用与流式输出](#62-llm-调用与流式输出)
  - [6.3 LLM 选型](#63-llm-选型)
- [第七章：对话记忆系统](#第七章对话记忆系统)
  - [7.1 Memory Compression](#71-memory-compression)
  - [7.2 Query Rewrite 与记忆的配合](#72-query-rewrite-与记忆的配合)
- [第八章：LangGraph 编排](#第八章langgraph-编排)
  - [8.1 StateGraph 概念](#81-stategraph-概念)
  - [8.2 项目中的 DAG 结构](#82-项目中的-dag-结构)
  - [8.3 为什么用 LangGraph](#83-为什么用-langgraph-而不是写-if-else)
- [第九章：RAGAS 评测体系](#第九章ragas-评测体系)
  - [9.1 评测数据集设计](#91-评测数据集设计)
  - [9.2 四个指标的底层原理](#92-四个指标的底层原理)
  - [9.3 Evaluator 与 Pipeline 分离](#93-evaluator-llm-与-pipeline-llm-分离)
  - [9.4 评测驱动优化](#94-评测驱动优化)
- [第十章：工程架构](#第十章工程架构)
  - [10.1 后端架构](#101-后端fastapi)
  - [10.2 前端架构](#102-前端electron--react)
  - [10.3 其他功能模块](#103-其他功能模块)
- [附录：面试高频问题速查](#附录面试高频问题速查)

---

## 第一章：基础理论

### 1.1 Transformer 架构

Transformer 是 2017 年 Google 论文 "Attention Is All You Need" 提出的架构。项目中**所有模型**都基于它：

- bge-m3（embedding）→ Transformer Encoder
- llama3.2（LLM）→ Transformer Decoder
- bge-reranker（reranker）→ Transformer Encoder

#### 1.1.1 Tokenizer（分词器）

文本进入 Transformer 前必须先切成 token。这步**直接决定了模型能不能理解输入**。

**三种主流算法：**

**(a) BPE（Byte Pair Encoding）— GPT / LLaMA 用的**

核心思想：从字符级别开始，不断合并最频繁出现的相邻字符对。

```
训练过程（在大量语料上）：

初始词表: 所有单个字符 ['a','b','c',...,'z',' ',...]

第1轮: 统计相邻字符对频率
  "th" 出现了 100万次 → 合并成新 token "th"
  词表: ['a','b',...,'th',...]

第2轮: "th" + "e" 出现了 80万次 → 合并成 "the"
第3轮: "in" 出现了 70万次 → 合并成 "in"
...

重复直到词表达到目标大小（通常 32K ~ 128K 个 token）
```

实际分词时：
```
"unhappiness" → ["un", "happiness"]     ← 见过的就整个保留
"transformers" → ["transform", "ers"]   ← 按学到的合并规则切
"asdfghjkl" → ["as", "df", "g", "h", "j", "k", "l"]  ← 没见过就拆碎
```

**(b) WordPiece — BERT 用的（bge-m3 也是 BERT 系）**

跟 BPE 类似，但合并策略不同：BPE 选频率最高的，WordPiece 选**合并后能最大化语料似然概率**的。实际效果差异不大。

标志性特征：子词前面加 `##` 表示不是词首：
```
"embedding" → ["em", "##bed", "##ding"]
```

**(c) SentencePiece — 多语言模型常用**

不依赖空格分词（对中文/日文很重要），直接在原始字节流上做 BPE 或 Unigram。bge-m3 和 llama3.2 都用了 SentencePiece 的变体。

**为什么 Tokenizer 对项目至关重要：**

```
英文模型 (all-MiniLM-L6-v2) 处理 "动态规划":
  词表里没中文 → "动","态","规","划" 各自变成 [UNK] 或随机 byte token
  → 4 个毫无语义的 token → 模型输出的向量毫无意义

多语言模型 (bge-m3) 处理 "动态规划":
  词表里有中文 → "动态", "规划" 被识别为有意义的 token
  → 训练时见过 "动态规划" 和 "dynamic programming" 的上下文
  → 输出的向量能正确表达语义
```

> **面试回答模板**：
> "我们之前用英文 embedding 处理中文知识库，RAGAS context_precision 只有 0.20。排查发现是 tokenizer 的词表不覆盖中文，所有中文字都变成了 UNK token，导致 embedding 无法捕获语义。换成 bge-m3（SentencePiece 词表覆盖 100+ 语言）后 precision 提升到 0.71。"

---

#### 1.1.2 Token Embedding + Positional Encoding

Tokenizer 输出的是 token ID（整数），需要转成向量模型才能处理。

**Token Embedding**：一个大查找表

```
词表大小: 32000
Embedding 维度: 768

Embedding Matrix: [32000 × 768] 的矩阵（随模型训练学到的）

token_id = 3847 ("动态")
→ 去矩阵第 3847 行取出一个 768 维的向量
→ [0.12, -0.34, 0.07, ..., 0.89]
```

这个初始向量只表示词"孤立"的含义，还没有上下文信息。

**Positional Encoding**：告诉模型每个 token 在哪个位置

Transformer 的 attention 是**无序的**（同时看所有 token），必须额外注入位置信息。

```
原始方法（BERT / 原版 Transformer）:
  学一个 position embedding 矩阵 [max_len × 768]
  token_embedding + position_embedding = 最终输入

新方法（LLaMA / GPT 用的 RoPE）:
  旋转位置编码，通过旋转矩阵把位置信息编码到 attention 计算中
  优势：可以外推到训练时没见过的更长序列
```

> **面试题**："为什么 Transformer 需要位置编码，而 RNN 不需要？"
>
> 因为 RNN 按顺序逐个处理 token，位置信息天然存在于处理顺序中。Transformer 并行处理所有 token，没有顺序概念，必须显式注入。

---

#### 1.1.3 Self-Attention 机制（核心中的核心）

**目标**：让每个 token 融合其他所有 token 的信息，生成上下文相关的表示。

假设输入是 3 个 token 的序列，每个是 768 维向量：

```
X = [x₁, x₂, x₃]   （3 × 768 矩阵）
```

**Step 1: 生成 Q、K、V**

```
Q = X × Wq    (3×768) × (768×768) = (3×768)
K = X × Wk    同上
V = X × Wv    同上

Wq, Wk, Wv 是三个可学习的权重矩阵
```

直觉：
- **Q（Query）** = "我在找什么信息？"
- **K（Key）** = "我能提供什么信息？"
- **V（Value）** = "我实际包含的信息"

**Step 2: 计算注意力分数**

```
Score = Q × K^T / √d

Q × K^T:
  q₁·k₁  q₁·k₂  q₁·k₃     每个值是两个向量的点积
  q₂·k₁  q₂·k₂  q₂·k₃     点积越大 = 越相关
  q₃·k₁  q₃·k₂  q₃·k₃

除以 √d (√768 ≈ 27.7):
  防止点积值过大导致 softmax 梯度消失
```

**为什么除以 √d？（面试高频题）**

假设 Q 和 K 的每个元素都是均值 0、方差 1 的随机变量。d 维向量的点积 = d 个乘积之和，方差 = d，标准差 = √d。

如果 d=768，点积可能到几十甚至上百。softmax 对大值很敏感：
```
softmax([100, 1, 1]) ≈ [1.0, 0.0, 0.0]  ← 梯度几乎为零，训练不动
```
除以 √d 把方差拉回到 1，让 softmax 输出更平滑。

**Step 3: Softmax 归一化**

```
Attention Weights = softmax(Score)

例如 token₁ 的注意力权重:
  softmax([2.1, 0.5, -0.3]) = [0.72, 0.15, 0.13]

  token₁ 把 72% 注意力放在自己，15% 放在 token₂，13% 放在 token₃
```

**Step 4: 加权求和**

```
Output = Attention Weights × V

token₁ 的新表示 = 0.72 × v₁ + 0.15 × v₂ + 0.13 × v₃
→ 融合了所有 token 的信息，但主要来自自己和最相关的 token
```

**完整公式**：

```
Attention(Q, K, V) = softmax(QK^T / √d) × V
```

**实际例子建立直觉**：

```
输入: "苹果 手机 很好用"

处理 "苹果" 时:
  "苹果"·"手机" = 1.8（很相关！训练数据中 "苹果手机" 经常共现）
  → softmax 后 "苹果" 的注意力主要集中在 "手机" 上
  → "苹果" 的输出向量偏向 "科技公司" 的含义

如果改成 "苹果 果汁 很好喝":
  "苹果"·"果汁" = 1.9
  → "苹果" 的输出向量偏向 "水果" 的含义
```

这就是 Transformer 能根据上下文理解一词多义的原因。

---

#### 1.1.4 Multi-Head Attention

实际使用多个"头"并行，每个头学到不同类型的关系：

```
BERT: 12 个头    bge-m3: 12 个头    LLaMA 3.2 3B: 24 个头
```

**为什么要多头？**

```
Head 1: 可能学到"语法关系" — 动词关注主语
Head 2: 可能学到"语义关系" — "苹果" 关注 "手机"
Head 3: 可能学到"位置关系" — 关注相邻词
Head 4: 可能学到"指代关系" — "它" 关注 "动态规划"
```

实现方式：
```
768 维 ÷ 12 头 = 每个头 64 维

把 Q, K, V 各切成 12 份，每份 64 维
12 个头各自独立做 attention
最后把 12 个输出拼接回 768 维
再过一个线性变换 Wo 做融合
```

> **面试回答**："Multi-Head 本质上是让模型同时从多个子空间捕获不同类型的依赖关系，增加了表达能力，而计算量跟 single-head 几乎相同，因为每个头的维度成比例缩小了。"

---

#### 1.1.5 Feed-Forward + LayerNorm + Residual

每一层 Transformer 除了 attention 还有：

```
输入 x
  ↓
Multi-Head Attention → attention_output
  ↓
Add & Norm: LayerNorm(x + attention_output)    ← 残差连接
  ↓
Feed-Forward Network (两层 MLP):
  FFN(x) = Linear₂(GELU(Linear₁(x)))
  768 → 3072 → 768（先扩大 4 倍再缩回来）
  ↓
Add & Norm: LayerNorm(ffn_input + ffn_output)  ← 又一个残差连接
  ↓
输出
```

**Residual Connection（残差连接）**：`output = f(x) + x`

> 深层网络有梯度消失问题。加了残差后梯度可以直接通过 "+" 传回去。如果某层学不到有用的东西，f(x)≈0，output≈x，至少不会变差。

**Layer Normalization**：把每层输出的均值归零、方差归一，稳定训练过程。

**FFN**：attention 负责 "token 之间的交互"，FFN 负责 "每个 token 自身的非线性变换"。可以理解为 attention 是 "沟通"，FFN 是 "思考"。

---

#### 1.1.6 Encoder vs Decoder

```
┌─────────────────────────────────────────────────────────┐
│  Encoder-only (BERT系)          │  Decoder-only (GPT系)    │
│                                 │                          │
│  bge-m3 (embedding)            │  llama3.2 (LLM)          │
│  bge-reranker (reranker)       │  gpt-4o-mini             │
│                                 │                          │
│  双向 attention:                │  单向 attention (causal):  │
│  每个 token 能看所有 token       │  每个 token 只能看前面的    │
│                                 │                          │
│  "苹果 [MASK] 很好喝"          │  "苹果" → "手" → "机"      │
│  ↑ 利用前后文预测被遮住的词      │  ↑ 逐个预测下一个 token    │
│                                 │                          │
│  适合：理解语义、生成向量         │  适合：生成文本            │
│  预训练：MLM(完形填空)           │  预训练：下一词预测         │
└─────────────────────────────────────────────────────────┘
```

**为什么 embedding 用 Encoder，LLM 用 Decoder？**

- Embedding 需要**理解整个句子** → 需要双向 attention
- LLM 需要**生成文本** → 必须单向，不能"偷看"还没生成的词

> **面试回答**："项目中 embedding 和 reranker 用 encoder-only（BERT系），需要双向理解语义。LLM 回答用 decoder-only（LLaMA），需要自回归生成文本。这也是为什么 embedding 模型和 LLM 是分开的两个模型。"

---

### 1.2 向量与相似度

#### 1.2.1 高维向量空间的直觉

embedding 向量是 **1024 维**（bge-m3）。用 2 维建立直觉：

```
假设一个极简的 2 维 embedding 空间:
  维度 1 = "跟算法相关的程度"
  维度 2 = "跟数据结构相关的程度"

"二分搜索"     → (0.9, 0.3)   ← 算法强相关，数据结构弱相关
"哈希表"       → (0.2, 0.9)   ← 算法弱相关，数据结构强相关
"红黑树的插入"  → (0.6, 0.8)   ← 都有点相关
"今天天气"     → (0.0, 0.0)   ← 都不相关
```

实际 1024 维时，每个维度不是人能命名的概念，而是模型训练中自动发现的**抽象语义特征**。

---

#### 1.2.2 三种距离度量

ChromaDB 默认用 **L2 距离**，面试需要知道三种的区别：

**(a) L2 距离（欧几里得距离）**

```
A = [1, 2, 3]    B = [4, 6, 3]

L2 = √((1-4)² + (2-6)² + (3-3)²) = √(9 + 16 + 0) = 5

值域: [0, +∞)  越小越相似
```

**(b) Cosine Similarity（余弦相似度）**

不看距离，看**方向是否一致**：

```
A = [1, 2, 3]    B = [2, 4, 6]     ← A 的 2 倍，方向完全一致

Cosine = (A·B) / (||A|| × ||B||) = 28 / 28 = 1.0   ← 完全相似！
L2 = √14 ≈ 3.7    ← 说它们"不近"

Cosine 只看方向，忽略长度。L2 看实际距离，长度有影响。
```

Cosine 更适合文本场景：同一句话用不同模型 encode，向量长度可能不同，但方向应该一致。

**(c) Inner Product（内积/点积）**

```
A·B = 1×2 + 2×4 + 3×6 = 28
值域: (-∞, +∞)  越大越相似
```

如果向量归一化（长度=1），内积 = cosine similarity。

---

#### 1.2.3 归一化后三者的关系

**关键公式（面试必会推导）**：

当 ||A|| = ||B|| = 1（归一化向量）时：

```
L2² = ||A - B||² = ||A||² + ||B||² - 2(A·B) = 2 - 2·cosine(A, B)
```

- cosine = 1（完全相似）→ L2 = 0
- cosine = 0（正交/无关）→ L2 = √2
- cosine = -1（完全相反）→ L2 = 2

**结论：对归一化向量，L2 和 cosine 排序结果完全一样。** bge-m3 输出是归一化的，所以 ChromaDB 用 L2 没问题。

---

#### 1.2.4 "相似度搜索" 在做什么

当用户问 "什么是动态规划"：

```
Step 1: query 向量化
  "什么是动态规划" → q = [0.12, -0.34, ..., 0.78]  (1024维)

Step 2: 跟数据库中所有 chunk 向量比较
  chunk_1 向量 → L2 = 0.03  ← 很近！
  chunk_2 向量 → L2 = 1.87  ← 很远
  chunk_3 向量 → L2 = 0.12  ← 较近
  ...

Step 3: 按距离排序，返回最近的 k=5 个
```

暴力搜索 242 个 chunk 还行，100 万个就太慢了 → 需要 ANN 索引（第四章）。

---

#### 1.2.5 为什么向量相似 ≈ 语义相似？

不是数学保证，是**训练出来的**。训练数据：

```
正样本对: ("什么是 DP", "dynamic programming 是什么") → 拉近
负样本对: ("什么是 DP", "今天吃什么")               → 推远
```

训练损失函数（InfoNCE Loss）：

```
Loss = -log( exp(sim(q, p⁺)/τ) / (exp(sim(q, p⁺)/τ) + Σ exp(sim(q, pᵢ⁻)/τ)) )

sim(q, p⁺) = 正样本相似度，要最大化
sim(q, pᵢ⁻) = 负样本相似度，要最小化
τ = temperature，控制分布的尖锐程度
```

训练了几十亿样本后，语义相近的句子向量方向接近，语义不同的向量方向远离。

> **面试题**："两个句子用词完全不同但意思一样，embedding 能捕获吗？"
>
> 能。比如 "DP的时间开销" 和 "动态规划的计算复杂度"，因为训练数据中有大量同义表述的正样本对。模型学到的是**语义级别的映射**，不是词级别匹配。这是 embedding 比 TF-IDF 强大的原因。

---

### 1.3 语言模型基础

#### 1.3.1 什么是语言模型？

本质就一件事：**预测下一个词的概率分布**。

```
输入: "动态规划的时间复杂度是"
输出:
  "O"    → 概率 0.35
  "多少" → 概率 0.20
  "指数" → 概率 0.08
  ...（词表中每个 token 都有一个概率）

选概率最高的 → "O"
继续: "...是O" → "(" 概率最高
继续: "...是O(" → "n" 概率最高 → ...
```

这就是 llama3.2 回答问题时在做的事 — 一个 token 一个 token 地生成。也是为什么 `call_llm_stream` 能流式输出 — 每生成一个 token 就立刻返回。

---

#### 1.3.2 预训练（Pre-training）

模型初始化时参数全是随机的。预训练在**海量文本**上教它理解语言。

**(a) MLM — Masked Language Model（BERT系 → bge-m3, bge-reranker）**

```
原文: "动态规划 是 一种 通过 将问题 分解为 子问题 来求解 的 方法"
遮住: "动态规划 是 一种 通过 将问题 [MASK] 子问题 来求解 的 方法"
目标: 预测 [MASK] = "分解为"

模型能看到前后文 → 双向 (Bidirectional)
→ 适合理解语义，不适合生成文本
```

**(b) CLM — Causal Language Model（GPT系 → llama3.2, gpt-4o-mini）**

```
原文: "动态规划 是 一种 通过 ..."

训练:
  输入 "动态规划"        → 预测 "是"
  输入 "动态规划 是"      → 预测 "一种"
  输入 "动态规划 是 一种"  → 预测 "通过"

模型只能看前面 → 单向 (Causal)
→ 天然适合生成文本
```

训练规模：
- BERT：约 33 亿 tokens
- bge-m3：数百亿 tokens
- llama3.2 3B：约 **9 万亿 tokens**
- GPT-4：据传 13 万亿+ tokens

> **关键理解**："预训练阶段模型没有见过任何问答数据，只学会了语言的统计规律。一个只做了预训练的 base model，你问它问题它不会'回答'，它只会'续写'。"

---

#### 1.3.3 从 "续写" 到 "回答"：指令微调

```
Base model:
  输入 "什么是动态规划？"
  输出 "什么是贪心算法？什么是分治？..."  ← 在续写问题列表
```

**指令微调（SFT）** 用问答数据教模型学会回答：

```
训练数据: { instruction: "什么是动态规划？", response: "动态规划是一种..." }
几万到几十万条
```

**llama3.2 完整训练流程：**

```
随机初始化
  ↓
① Pre-training（9T tokens 互联网文本）
  → base model，只会续写
  ↓
② SFT（指令微调，高质量问答数据）
  → 学会了遵循指令、回答问题
  ↓
③ RLHF / DPO（人类偏好对齐）
  → 学会了拒绝有害请求、生成更有用的回答
  → llama3.2-3B-instruct（项目中用的就是这个）
```

> **面试题**："RLHF 是什么？"
>
> Reinforcement Learning from Human Feedback。让人类对模型的多个回答排序（A比B好），训练 reward model 学习偏好，用 PPO 优化模型使 reward 最大化。DPO 是更简洁的替代方案，不需要单独训练 reward model。

---

#### 1.3.4 微调 vs Prompt Engineering

```
┌────────────────────┬──────────────────────────────────┐
│  微调 (Fine-tuning) │  提示工程 (Prompt Engineering)    │
├────────────────────┼──────────────────────────────────┤
│  修改模型参数        │  不改模型，只改输入文本            │
│  需要训练数据+GPU    │  只需要写好 system prompt          │
│  效果持久，成本高     │  效果即时，成本低                  │
│  能学全新能力        │  只能在模型已有能力范围内引导       │
└────────────────────┴──────────────────────────────────┘
```

项目用的是 Prompt Engineering（`rag_service.py` 中的 SYSTEM_PROMPT）。

> **面试回答**："选择 prompt engineering 原因有三：1) 面向普通用户，不能要求有 GPU 做微调；2) 知识库因人而异，没有通用微调数据集；3) RAG 的核心价值就是不需要微调 — 知识存在外部数据库而不是模型参数中，更新只需重新 ingest。"

---

#### 1.3.5 参数量与能力的关系

```
llama3.2 3B  → 30 亿参数 → ~4GB     gpt-4o-mini → 参数量未公开
llama3.1 8B  → 80 亿参数 → ~8GB     GPT-4       → 传闻 1.8T (MoE)
llama3.1 70B → 700 亿参数 → ~40GB
```

**Scaling Laws（OpenAI 2020）**：

```
模型性能 ∝ f(参数量 N, 数据量 D, 计算量 C)    三者缺一不可

参数量 ×10 → 性能不是 10 倍提升
         → 在 log-log 图上呈直线下降（loss 降低）
```

**涌现能力（Emergent Abilities）**：

```
模型大小:   3B    8B    70B   175B+
───────────────────────────────────
基础问答:   ✓     ✓     ✓     ✓
多步推理:   ✗     △     ✓     ✓
指令遵循:   △     ✓     ✓     ✓
代码生成:   ✗     △     ✓     ✓
```

> 这解释了评测数据：llama3.2 3B faithfulness 0.72（约束遵循弱），gpt-4o-mini 0.92（更能严格遵循 "只基于 context 回答"）。

---

#### 1.3.6 项目中的模型分工

```
┌──────────────┬──────────────┬────────────┬────────────────┐
│  用途         │  模型         │  架构       │  为什么选它      │
├──────────────┼──────────────┼────────────┼────────────────┤
│  Embedding   │  bge-m3      │  Encoder   │  多语言、1024维  │
│  (向量化)     │  1.2GB       │  (BERT系)   │  中英文都能处理  │
├──────────────┼──────────────┼────────────┼────────────────┤
│  Reranker    │  bge-reranker│  Encoder   │  多语言 cross-  │
│  (重排序)     │  -v2-m3 2.2GB│  (BERT系)   │  encoder，精排  │
├──────────────┼──────────────┼────────────┼────────────────┤
│  LLM         │  llama3.2    │  Decoder   │  免费、轻量      │
│  (生成回答)   │  3B, ~4GB    │  (GPT系)    │  普通电脑能跑    │
├──────────────┼──────────────┼────────────┼────────────────┤
│  Evaluator   │  gpt-4o-mini │  Decoder   │  评分需要强模型   │
│  (RAGAS评分)  │  API 调用     │  (GPT系)    │  独立于被测模型  │
└──────────────┴──────────────┴────────────┴────────────────┘
```

---

## 第二章：Embedding（向量化）

> 对应代码：`backend/app/services/embedding_service.py`

### 2.1 从 Word Embedding 到 Sentence Embedding

**演进历史：**

**(a) Word2Vec（2013）— 最早的词向量**

每个词一个固定向量，不考虑上下文：

```
"苹果" → [0.3, 0.7, 0.1]   ← 永远是这个向量，不管旁边是"手机"还是"果汁"
```

训练方式（Skip-gram）：用中心词预测周围词。经常出现在相似上下文的词向量接近。

**致命缺陷**：一词多义问题。

**(b) ELMo（2018）— 上下文相关的词向量**

用双向 LSTM，同一个词在不同句子中得到不同向量。但 LSTM 顺序处理，慢。

**(c) BERT（2018）— Transformer Encoder 词向量**

用 Transformer 替代 LSTM，双向 attention 充分融合上下文。快且好。但输出是每个 token 的向量，不是整句话的向量。

**(d) Sentence-BERT / 现代 Sentence Embedding（2019 至今）**

bge-m3 用的方案。在 BERT 基础上加 **Pooling + 对比学习训练**：

```
"什么是动态规划"
    ↓
Transformer Encoder (12层 attention)
    ↓
[CLS_vec, tok1_vec, tok2_vec, ..., tokN_vec]  ← 每个 token 一个向量
    ↓
Mean Pooling: 所有 token 向量取平均
    ↓
[0.12, -0.34, ..., 0.78]   ← 一个 1024 维的句子向量
```

---

### 2.2 Pooling 策略

把多个 token 向量合成一个句子向量：

**(a) CLS Pooling**

```
输入: [CLS] 什么 是 动态 规划
        ↑ 直接取 [CLS] 的向量

效果一般：[CLS] 预训练时主要用于分类任务，不一定能很好表示整句语义
```

**(b) Mean Pooling（bge-m3 用的）**

```
sentence_vec = (tok1_vec + tok2_vec + ... + tokN_vec) / N

优点: 信息最全面，每个词都有贡献。通常效果最好，是主流选择
缺点: 可能被不重要的词（"的"、"是"）稀释
```

**(c) Max Pooling**

```
每个维度取所有 token 中的最大值 → 保留最突出的特征
```

---

### 2.3 对比学习（Contrastive Learning）训练细节

**训练数据来源：**

```
来源1: 人工标注的语义相似度数据集
  ("如何提升代码效率", "优化程序性能的方法") → 相似

来源2: 自然配对数据（弱监督）
  (问题, 回答) — QA 网站
  (标题, 正文) — 文章/论文
  (query, 点击文档) — 搜索日志

来源3: 多语言平行语料
  ("动态规划", "dynamic programming") → 翻译对
  这就是 bge-m3 学会跨语言的原因
```

**In-Batch Negatives（核心训练技巧）**：

```
一个 batch 有 256 个正样本对: (q₁, p₁⁺), (q₂, p₂⁺), ...

对于 q₁:
  正样本: p₁⁺
  负样本: p₂⁺, p₃⁺, ..., p₂₅₆⁺  ← 其他 query 的正样本当负样本

→ 不需要额外采样负样本，batch 越大效果越好
```

**Hard Negatives（困难负样本）**：

```
简单负样本: ("动态规划", "今天天气") → 太容易区分
困难负样本: ("动态规划", "贪心算法") → 有点相关但不是一个东西

用 BM25 或旧模型检索出"看起来相关但不对"的文档作为 hard negative
→ 逼迫模型学得更精细
```

bge-m3 大量使用 hard negatives，这是它比早期模型好的重要原因。

> **面试题**："对比学习的 temperature τ 有什么作用？"
>
> τ 控制 softmax 分布的尖锐程度。τ 小 → 更关注最难区分的样本，训练不稳定。τ 大 → 分布更平滑，区分度低。通常设 0.05-0.1。

---

### 2.4 bge-m3 的三种检索模式

**(a) Dense Retrieval（项目中用的）**

```
query → 一个 1024 维向量    doc → 一个 1024 维向量
相似度 = cosine(query_vec, doc_vec)

优点: 语义匹配强（"DP" 能匹配 "动态规划"）
缺点: 可能丢失精确关键词（搜 "LC 312" 可能匹配不上）
```

**(b) Sparse Retrieval（类似 BM25 的学习版）**

```
query → 稀疏向量 [0, 0, 2.1, 0, 0, 3.5, 0, ...]
大部分维度是 0，非零维度对应重要的 term

优点: 精确关键词匹配
缺点: 不理解语义同义词
```

**(c) ColBERT（多向量交互）**

```
query → N 个向量（每个 token 一个）
doc   → M 个向量（每个 token 一个）

相似度 = Σᵢ maxⱼ sim(qᵢ, dⱼ)  对 query 的每个 token，找 doc 中最匹配的

优点: token 级别交互，比 single-vector 更精确
缺点: 存储量大（每文档 M 个向量 vs 1 个）
```

> **为什么项目只用 Dense？**
>
> 1) ChromaDB 只支持 single-vector 存储；2) 个人知识库规模不大，dense 够用；3) 存储开销小（4KB/chunk vs 400KB/chunk for ColBERT）。如果需要精确关键词匹配，可以考虑 dense + sparse 混合检索。

---

### 2.5 Embedding 的局限性

| 局限性 | 说明 | 项目中的解决方案 |
|--------|------|----------------|
| 语义漂移 | "不使用递归的方法" → 可能匹配到讲递归的文档（否定词难处理） | Reranker 精排纠正 |
| 压缩损失 | 1000字 chunk → 1024维向量，细节丢失 | Heading-aware chunking 保证语义完整 |
| 关键词弱 | dense vector 不擅长精确匹配 "LC 312" | Multi-Query 扩展不同表述 |
| OOD 问题 | 训练时没见过的专业术语 embedding 质量差 | HyDE 用 LLM 生成接近文档的表述 |

---

## 第三章：Ingestion（数据入库）

> 对应代码：`backend/app/services/ingest_service.py`

### 3.1 文件处理

整个 ingestion 流程：

```
文件 (.md / .pdf)
   ↓
① 文件发现 → ② 读取 + Frontmatter 解析 → ③ Hash 去重
   ↓
④ 分块（Heading-aware / Fixed-size）→ ⑤ 存入 ChromaDB（自动 embedding）
   ↓
⑥ 更新 SQLite 元数据
```

**Frontmatter 解析**（`frontmatter_parser.py`）：

```markdown
---
title: 动态规划总结
category: algorithm
tags: [dp, leetcode]
difficulty: medium
pack_id: leetcode-notes
---

正文内容...
```

解析出结构化元数据（title, category, tags, difficulty, pack_id），存入 chunk 的 metadata 中，支持按 pack_id 等字段过滤检索。

**PDF 处理**（`pdf_extractor.py`）：

使用 PyMuPDF (fitz) 提取纯文本，逐页拼接。

---

### 3.2 分块策略（Chunking）

**为什么需要分块？**

1. LLM context window 有限，不能把整个文档塞进去
2. 检索需要粒度 — 返回整篇文档噪音太大，返回单句又缺上下文
3. Embedding 对长文本的压缩损失大，chunk 越短向量越精确

**两种策略：**

**(a) Heading-aware chunking（.md 文件）—** `heading_chunker.py`

按 Markdown 标题切割，保证语义完整：

```python
# 三个关键参数
MIN_SECTION_LENGTH = 100    # 短于此的节与下一节合并
MAX_SECTION_LENGTH = 1500   # 长于此的节用 RecursiveCharacterTextSplitter 再切
```

处理逻辑：
```
① 按标题（# ~ ######）切割成 sections
② 短节合并：< 100 chars 的节向下合并到下一节
   → 防止产生太碎的 chunk（如只有一行的小标题）
③ 长节再切：> 1500 chars 的节用 RecursiveCharacterTextSplitter 再切
   → 参数 chunk_size=1000, overlap=200
④ 每个 chunk 带 section_heading metadata
```

**(b) Fixed-size chunking（.pdf 文件 / fallback）**

使用 LangChain 的 `RecursiveCharacterTextSplitter`：

```python
CHUNK_SIZE = 1000     # 每个 chunk 最大字符数
CHUNK_OVERLAP = 200   # 相邻 chunk 重叠字符数
```

RecursiveCharacterTextSplitter 按优先级递归尝试分隔符：`"\n\n"` → `"\n"` → `" "` → `""`。优先在段落间切，实在不行才在句子中间切。

**面试深挖问题：**

> **Q: 为什么不直接用固定大小分块？**
>
> A: 固定大小会把完整概念从中间切断。比如 "二分搜索" 标题下有 800 字，固定分块可能在第 500 字断开，前后两个 chunk 各只有半个概念。Heading-aware 保证一个标题下的内容是完整的语义单元。

> **Q: chunk_size=1000 和 overlap=200 怎么选的？**
>
> A: 经验值。1000 tokens 大约是 LLM 能充分理解的一段文本长度，太大引入噪音，太小丢失上下文。Overlap=200（20%）保证切割边界处的信息不丢失。

---

### 3.3 去重与增量更新

```python
file_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()

# 如果 hash 没变就跳过
if existing and existing["file_hash"] == file_hash and not force:
    return {"status": "skipped"}

# 文件更新时先删旧 chunks 再存新的
self.delete_chunks_for_file(file_path_str)
# ... 重新分块存储
```

保证：
- 相同内容不重复入库（SHA-256 hash）
- 文件更新时旧数据被完全替换
- 支持 `force=True` 强制重新入库（换 embedding 模型时需要）

---

### 3.4 存储流程

```python
# ChromaDB 的 add() 内部流程：
self._collection.add(
    ids=ids,           # UUID
    documents=documents,  # chunk 原文
    metadatas=metadatas   # file_path, chunk_index, section_heading, ...
)
# ChromaDB 自动调用 embedding_function 把 documents 向量化并存储
```

同时在 SQLite 中记录元数据（文件路径、hash、chunk 数量、索引状态等），用于管理和展示。

---

## 第四章：向量数据库（ChromaDB）

### 4.1 向量索引与 ANN

**暴力搜索**：逐个比较，O(N)。242 个 chunk 还行，100 万个就太慢。

**ANN（Approximate Nearest Neighbor）**：牺牲少量精度换巨大速度提升。

**ChromaDB 用的 HNSW（Hierarchical Navigable Small World）算法**：

```
构建阶段：构建多层图结构
  Layer 3 (最稀疏):  A ---- B           ← 几个节点，长距离连接
  Layer 2:          A -- C -- B -- D    ← 更多节点
  Layer 1:          A-C-E-B-F-D-G-H    ← 更多节点
  Layer 0 (最密集):  所有节点，短距离连接  ← 包含全部数据

搜索过程：
  1. 从最高层开始，贪心找到当前层的最近邻
  2. 进入下一层，从上层找到的位置继续细化
  3. 重复直到最底层
  → 时间复杂度 O(log N)
```

**精度 vs 速度 trade-off**：

HNSW 的 recall@10 通常 95-99%。对 RAG 可以接受 — 不需要找到绝对最相似的 chunk，前几名里有相关的就够了。

> **面试题**："ANN 和精确最近邻的区别？"
>
> ANN 牺牲少量精确度换取巨大速度提升。100 万数据暴力搜索要比较 100 万次，HNSW 只需要几百次。

---

### 4.2 ChromaDB 架构

```python
# 持久化客户端，数据存磁盘
chroma_client = chromadb.PersistentClient(path="./chroma_data")

# Collection 类似数据库的表
collection = chroma_client.get_or_create_collection(
    name="knowhive",
    embedding_function=embedding_fn  # 自动向量化
)

# 查询：query 自动向量化 → HNSW 搜索 → 返回 top-k
results = collection.query(query_texts=[query], n_results=k)

# metadata filter（按 pack_id 过滤某个知识包）
results = collection.query(
    query_texts=[query],
    n_results=k,
    where={"pack_id": "leetcode-notes"}
)
```

ChromaDB 内部流程：
1. 用 `embedding_function` 把 query 向量化
2. 在 HNSW 索引中搜索最近的 k 个向量
3. 返回对应的原文 + metadata

---

## 第五章：Retrieval（检索）

> 对应代码：`backend/app/services/rag_service.py`

### 5.1 基础检索流程

```python
# rag_service.py:48-62
def retrieve(self, query, k=5, where=None):
    results = self._collection.query(query_texts=[query], n_results=k)
    chunks = []
    for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
        chunks.append({
            "content": doc,
            "file_path": meta["file_path"],
            "chunk_index": meta["chunk_index"],
        })
    return chunks
```

流程：query → embedding → ChromaDB HNSW 搜索 → top-5 chunks

**k=5 的选择依据**：5 个 chunks × ~500 tokens/chunk ≈ 2500 tokens 输入，加上 system prompt 和输出，在 `num_ctx=8192` 内绰绰有余。太多会引入噪音，太少可能遗漏信息。

---

### 5.2 Pre-Retrieval 策略

通过 LangGraph 条件路由选择（`rag_graph.py:40-47`）。

#### 5.2.1 Query Rewrite（多轮对话改写）

> 对应代码：`backend/app/services/query_rewriter.py`

```
对话历史: "帮我讲讲动态规划" → "它的时间复杂度呢？"
                                  ↓ 改写
                            "动态规划的时间复杂度是多少？"
```

实现：从 SQLite 取最近 N 轮对话 + 压缩摘要，让 LLM 改写为独立问题。

```python
REWRITE_PROMPT = (
    "Given the conversation history below and a follow-up question, "
    "rewrite the follow-up question to be a standalone question..."
)
```

> **为什么需要？** "它的时间复杂度呢？" 直接拿去检索，embedding 不知道 "它" 指什么，检索不到有用内容。

**触发条件**：`config.chat_memory_turns > 0` 时才触发（`rag_graph.py:33-37`）。

---

#### 5.2.2 HyDE（Hypothetical Document Embeddings）

> 对应代码：`backend/app/services/hyde_service.py`

```
用户问题: "什么是动态规划？"
    ↓ LLM 生成假设性文档
"动态规划是一种通过将问题分解为重叠子问题来求解的算法设计方法..."
    ↓ 用这个假设文档去检索（而不是原始问题）
```

```python
HYDE_PROMPT_TEMPLATE = (
    "Please write a short passage (2-4 sentences) that directly answers "
    "the following question. Write as if you are quoting from a relevant "
    "document..."
)
```

**为什么有效？**

用户问题通常很短（"什么是 DP？"），而知识库是描述性段落。问题和文档在语义空间可能不够近。HyDE 生成类似文档风格的文本，跟真实文档在语义空间更近。

本质：把 **query-document 的语义鸿沟**变成 **document-document 的相似匹配**。

**缺点**：1) 额外一次 LLM 调用，增加延迟；2) 如果 LLM 生成的假设文档方向错了（幻觉），反而检索到错误内容。适合知识密集型具体问题，不适合模糊的探索性问题。

---

#### 5.2.3 Multi-Query（多查询扩展）

> 对应代码：`backend/app/services/multi_query_service.py`

```
"DP的时间复杂度" → LLM 生成 3-5 个变体：
  1. "动态规划算法的计算复杂度分析"
  2. "DP问题的时间空间开销"
  3. "dynamic programming time complexity"
→ 每个变体分别检索 → 合并去重（按 file_path + chunk_index）
```

```python
MULTI_QUERY_PROMPT = (
    "Generate 3 to 5 different versions of the following question. "
    "Each version should approach the topic from a different angle..."
    "IMPORTANT: Generate variants in the SAME LANGUAGE as the original question. "
)
```

**为什么有效？** 用户的一个问题可能只覆盖一种表述方式。扩展多个变体相当于撒更大的网，提高召回率。

**项目中的实测结论**：在 242 chunks 的小知识库上反而引入噪音（precision 下降），数据量大时才有优势。

---

#### 5.2.4 Strategy Classifier（策略分类器）

> 对应代码：`backend/app/services/strategy_classifier.py`

两种分类方式：

**(a) 规则分类（`classify_query`）**

```python
# 对比类问题 → multi_query
_CN_COMPARISON_PATTERNS = [r"对比", r"区别", r"优缺点", r"还是", r"比较"]

# 知识探索类问题 → hyde
_CN_INTERROGATIVE_PATTERNS = [r"什么是", r"如何", r"为什么", r"怎么", r"解释"]

# 短查询（≤8字符无问号）→ multi_query
# 其他 → none（直接检索）
```

**(b) LLM 分类（`classify_query_llm`）** — 更准确但更慢

让 LLM 判断 query 属于 hyde / multi_query / none 哪种类型。失败时 fallback 到规则分类。

---

### 5.3 Post-Retrieval：Reranking

> 对应代码：`backend/app/services/reranker_service.py`

**Bi-Encoder（embedding 检索）vs Cross-Encoder（reranker）的本质区别**：

```
Bi-Encoder:                        Cross-Encoder:
  query → 向量                       (query, doc) → 一起送入模型 → 分数
  doc   → 向量
  计算两个向量的距离

  速度：快（可预计算 doc 向量）        速度：慢（每对都过一次模型）
  精度：一般                          精度：高
```

**为什么 Cross-Encoder 更准？**

Bi-Encoder 独立编码 query 和 document，丢失词级交互信息。Cross-Encoder 把 query 和 document 拼接成一个序列送入 Transformer，attention 机制可以直接计算 query 中每个词和 document 中每个词的交互关系。

**为什么不直接用 Cross-Encoder 检索？**

太慢。10 万个 chunks 就要跑 10 万次模型前向传播。所以用**两阶段检索**：Bi-Encoder 粗筛 top-k（毫秒级） → Cross-Encoder 精排 k 个（也是毫秒级）。

**项目实现**：

```python
# reranker_service.py
RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"   # 多语言 cross-encoder, 2.2GB

def rerank(self, query, chunks, top_k=5):
    pairs = [[query, chunk["content"]] for chunk in chunks]
    scores = self._model.predict(pairs)
    # 按分数降序排列，返回 top_k
    scored_chunks.sort(key=lambda c: c["rerank_score"], reverse=True)
    return scored_chunks[:top_k]
```

**实测效果**：
- 英文 reranker（ms-marco-MiniLM）处理中文反而有害 → 换成多语言 bge-reranker-v2-m3
- context_precision 从 0.71 提升到 0.82

---

## 第六章：Generation（生成）

> 对应代码：`backend/app/services/rag_service.py` + `backend/app/services/llm_factory.py`

### 6.1 Prompt Engineering

**System Prompt 设计**（`rag_service.py:17-22`）：

```python
SYSTEM_PROMPT = (
    "You are a helpful AI assistant for a personal knowledge base. "
    "Answer the user's question based on the provided context from their documents. "
    "If the context doesn't contain relevant information, say so honestly. "
    "Cite the source file paths when referencing specific information."
)
```

关键设计点：
1. **"based on the provided context"** — 限制只用 context 回答，减少幻觉
2. **"say so honestly"** — 不知道就说不知道，不要编
3. **"Cite the source"** — 要求引用来源，增加可信度

**Context 组装格式**（`rag_service.py:87-97`）：

```
Context from knowledge base:

[Source: /path/to/file1.md]
chunk1 内容...

[Source: /path/to/file2.md]
chunk2 内容...

Question: 用户的问题
```

支持 `custom_system_prompt`：用户可在设置中添加自定义指令，拼接在 SYSTEM_PROMPT 之后。

---

### 6.2 LLM 调用与流式输出

**LLM 工厂**（`llm_factory.py`）— 统一抽象层：

```python
def create_chat_model(config):
    if config.llm_provider == LLMProvider.OLLAMA:
        return ChatOllama(model=config.model_name, base_url=config.base_url, num_ctx=8192)
    elif config.llm_provider == LLMProvider.OPENAI_COMPATIBLE:
        return ChatOpenAI(model=config.model_name, base_url=config.base_url, api_key=...)
    elif config.llm_provider == LLMProvider.ANTHROPIC:
        return ChatAnthropic(model=config.model_name, api_key=..., anthropic_api_url=...)
```

**两种调用方式**：

```python
# 一次性返回（eval 用）
response = await model.ainvoke(messages)

# 流式输出（聊天用，逐 token 返回）
async for chunk in model.astream(messages):
    yield chunk.content
```

**num_ctx=8192 的重要性**：

Ollama 默认只分配 2048 tokens context window。5 个 chunks + system prompt 约 2000-3000 tokens，加上输出，2048 完全不够。设为 8192 绰绰有余。

---

### 6.3 LLM 选型

| 模型 | 参数量 | 内存 | 速度 | 免费 | faithfulness |
|------|--------|------|------|------|:----------:|
| llama3.2 3B | 30亿 | ~4GB | 快 | 是 | 0.72 |
| llama3.1 8B | 80亿 | ~8GB | 中 | 是 | 更高 |
| gpt-4o-mini | 未公开 | API | 快 | 否 | 0.92 |

选 llama3.2 3B 作为默认：项目定位是本地免费、低门槛，让尽量多的用户能用。用户想要更好效果可以切换模型或接入 API。

> **面试回答**："检索层优化（多语言 embedding + reranker）弥补了 LLM 能力差距 — 检索精度 0.82 和回答相关性 0.83 都跟 OpenAI 持平，唯一差距在 faithfulness（0.72 vs 0.92），后续通过 prompt engineering 优化。"

---

## 第七章：对话记忆系统

### 7.1 Memory Compression

> 对应代码：`backend/app/services/memory_compression_service.py`

**问题**：多轮对话的历史越来越长，但 LLM context window 有限。

**解决方案：两层记忆**

```
短期记忆: 最近 N 轮完整对话（config.chat_memory_turns）
长期记忆: 超过阈值后 LLM 压缩成摘要（config.memory_compression_threshold）
```

**压缩流程**：

```python
async def compress_if_needed(config):
    # 1. 找到上次压缩的 watermark（chat_summaries 表的 MAX(last_message_id)）
    # 2. 统计 watermark 之后的未压缩消息数量
    # 3. 如果超过 threshold → 调用 LLM 压缩成摘要 → 存入 chat_summaries 表
```

**触发时机**：每次聊天回答结束后，在后台异步触发（`chat.py:126`）：

```python
asyncio.create_task(compress_if_needed(config))
```

**压缩 Prompt**：

```python
SUMMARIZE_SYSTEM_PROMPT = (
    "You are a conversation summarizer. Given a sequence of chat messages, "
    "produce a concise summary that captures the key topics discussed..."
)
```

---

### 7.2 Query Rewrite 与记忆的配合

```
用户第 N 轮提问: "它的时间复杂度呢？"
    ↓
fetch_chat_context(n_turns):
  → 取出所有压缩摘要 (chat_summaries)
  → 取出最近 N 条完整消息 (chat_messages)
    ↓
rewrite_query(question, history, summaries):
  → LLM: "根据历史上下文，'它'指的是动态规划"
  → 输出: "动态规划的时间复杂度是多少？"
    ↓
用改写后的问题去检索 → 得到正确的 chunks
```

这是一个完整的记忆链路：对话存储 → 超阈值压缩 → 下一轮改写时使用。

---

## 第八章：LangGraph 编排

> 对应代码：`backend/app/services/rag_graph.py`

### 8.1 StateGraph 概念

LangGraph 是 LangChain 团队开发的图编排框架。核心概念：

- **节点（Node）**：每个处理步骤（retrieve, rerank, generate 等）
- **边（Edge）**：步骤之间的连接
- **条件边（Conditional Edge）**：根据 state 动态路由
- **State（TypedDict）**：在节点间传递的数据

```python
class RAGState(TypedDict, total=False):
    question: str
    k: int
    pre_retrieval_strategy: str    # "none" | "hyde" | "multi_query"
    use_reranker: bool
    chat_memory_turns: int
    hypothetical_doc: str
    pack_id: str
    custom_system_prompt: str
    chunks: list[dict[str, Any]]
    sources: list[str]
    messages: list[dict[str, str]]
    answer: str
```

---

### 8.2 项目中的 DAG 结构

```
START
  ↓
[chat_memory_turns > 0?]
  ├── yes → rewrite_query → route_pre_retrieval
  └── no  → route_pre_retrieval
                ↓
          [pre_retrieval_strategy?]
            ├── "hyde"        → hyde → retrieve
            ├── "multi_query" → multi_query ──┐
            └── "none"        → retrieve      │
                ↓                             │
          [use_reranker?]    ←────────────────┘
            ├── true  → rerank → build_prompt
            └── false → build_prompt
                            ↓
                        generate
                            ↓
                          END
```

**三个路由决策点**（`rag_graph.py`）：

```python
# 决策 1: 是否改写 query
def _start_route(state):
    if state.get("chat_memory_turns", 0) > 0:
        return "rewrite_query"
    return "route_pre_retrieval"

# 决策 2: 选哪种预检索策略
def _pre_retrieval_route(state):
    strategy = state.get("pre_retrieval_strategy", "none")
    if strategy == "hyde": return "hyde"
    if strategy == "multi_query": return "multi_query"
    return "retrieve"

# 决策 3: 是否用 reranker
def _post_retrieve_route(state):
    if state.get("use_reranker", False): return "rerank"
    return "build_prompt"
```

**两种 Graph**：

- `create_rag_graph`: 完整版（包含 generate），eval 用
- `create_rag_prep_graph`: 准备版（到 build_prompt 结束），聊天时用，因为 generate 需要流式输出，单独调用 `call_llm_stream`

---

### 8.3 为什么用 LangGraph 而不是写 if-else

1. **可视化**：图结构可以生成流程图，方便理解和调试
2. **可扩展**：新增策略只需加节点 + 路由条件，不改已有代码
3. **State 管理**：TypedDict 明确定义数据流，每个节点只读写自己需要的字段
4. **可复用**：`_build_graph_nodes` 抽取共用节点逻辑，两种 Graph 共享

---

## 第九章：RAGAS 评测体系

> 对应代码：`backend/app/eval_ragas.py`

### 9.1 评测数据集设计

评测数据集是人工标注的 QA 对（`eval_dataset.json`）：

```json
[
  {
    "question": "Dijkstra算法的时间复杂度是多少？它有什么限制条件？",
    "ground_truth": "使用优先队列实现的Dijkstra算法时间复杂度为O((V+E)logV)。它的限制条件是只能处理非负权重的图，不能处理负权边。"
  }
]
```

目前 20 个样本，覆盖不同题型：事实查询、算法分析、对比问题、多步推理等。

---

### 9.2 四个指标的底层原理

每个问题经历：
1. **Retrieve** → 5 个 chunks
2. **Generate** → answer（Pipeline LLM）
3. **Evaluate** → 四个分数（Evaluator LLM = gpt-4o-mini）

#### (a) Faithfulness（忠实度）— 0.72 (Ollama) / 0.92 (OpenAI)

> "LLM 的回答是否严格基于 context？有没有编造？"

```
评估过程:
  1. Evaluator 把 answer 拆成若干 claims（声明）
     "Dijkstra时间复杂度为O((V+E)logV)，不能处理负权边"
     → claim1: "时间复杂度为O((V+E)logV)"
     → claim2: "不能处理负权边"

  2. 逐条检查每个 claim 是否在 contexts 中有依据
     claim1 → contexts 中找到了 → ✓
     claim2 → contexts 中找到了 → ✓
     → faithfulness = 2/2 = 1.0

  如果 answer 包含了 contexts 中没有的信息（幻觉） → 分数降低
```

**受什么影响**：LLM 的指令遵循能力、system prompt 的约束力。

#### (b) Answer Relevancy（回答相关性）— 0.83

> "回答是否在回答用户问的问题？"

```
评估过程:
  1. Evaluator 根据 answer 反向生成 3 个问题
     answer → "Dijkstra的时间复杂度是什么？"
              "Dijkstra有什么限制？"
              "图算法的复杂度分析"

  2. 计算这些反向问题与原始 question 的 embedding 相似度
     原问: "Dijkstra算法的时间复杂度是多少？"
     → 平均相似度 = relevancy score
```

#### (c) Context Precision（检索精度）— 0.82

> "检索到的 chunks 里，有多少是真正有用的？"

```
评估过程:
  1. Evaluator 看每个 chunk，判断是否包含回答问题所需的信息
  2. 按排名加权计算（排名靠前的 useful chunk 贡献更大）

  高分 = 检索到的 5 个 chunks 大部分有用
  低分 = 检索到了很多不相关内容
```

**受什么影响**：embedding 模型质量、reranker

#### (d) Context Recall（检索召回率）— 0.67

> "标准答案里的信息，能否从检索到的 chunks 里找到？"

```
评估过程:
  1. Evaluator 把 ground_truth 拆成若干知识点
  2. 检查每个知识点是否被某个 chunk 覆盖

  高分 = ground_truth 的所有知识点都能在 chunks 里找到
  低分 = 有些知识点检索不到
```

**受什么影响**：embedding 模型、chunk 策略、知识库完整性

---

### 9.3 Evaluator LLM 与 Pipeline LLM 分离

```
RAG Pipeline LLM (被考生)     ←  Ollama / OpenAI，config.yaml 配置
RAGAS Evaluator LLM (考官)    ←  固定 gpt-4o-mini，代码硬编码
```

好处：
- 换不同 "考生" 时，"考官" 始终一致，评分标准可比
- 避免用弱模型给自己打分（学生自己批卷不客观）

```python
# eval_ragas.py:234-240
def _create_evaluator_llm(model="gpt-4o-mini"):
    client = OpenAI()
    return llm_factory(model, client=client, max_tokens=8192)
```

---

### 9.4 评测驱动优化

项目中的优化都是靠评测数据验证的：

```
┌────────────────────────────┬─────────┬─────────┬─────────┬─────────┐
│ 配置                        │ Faith   │ Relev   │ Prec    │ Recall  │
├────────────────────────────┼─────────┼─────────┼─────────┼─────────┤
│ 英文 embed (baseline)       │ 0.57    │ 0.40    │ 0.20    │ 0.25    │
│ + 多语言 embed (bge-m3)     │ 0.84    │ 0.87    │ 0.71    │ 0.60    │
│ + 多语言 reranker           │ 0.92    │ 0.83    │ 0.82    │ 0.60    │
│ + multi-query              │ 下降     │ 下降     │ 下降     │ 下降     │
│ Ollama + 多语言 + reranker  │ 0.72    │ 0.83    │ 0.82    │ 0.67    │
└────────────────────────────┴─────────┴─────────┴─────────┴─────────┘

关键发现:
  1. 英文 embed → 多语言: precision 0.20→0.71（Tokenizer 词表修复）
  2. + reranker: precision 0.71→0.82（cross-encoder 精排）
  3. multi-query 在 242 chunks 的小知识库上反而引入噪音
  4. Ollama vs OpenAI: 检索指标持平，faithfulness 差距 0.20
```

---

## 第十章：工程架构

### 10.1 后端（FastAPI）

```
backend/
├── app/
│   ├── main.py              # FastAPI 应用入口
│   ├── config.py             # AppConfig 数据类 + 枚举定义
│   ├── database.py           # SQLite 异步连接管理
│   ├── eval_ragas.py         # RAGAS 评测 CLI
│   ├── routers/              # API 路由层
│   │   ├── chat.py           # POST /chat (SSE streaming)
│   │   ├── ingest.py         # 文件入库 API
│   │   ├── knowledge.py      # 知识库管理 API
│   │   ├── config.py         # 配置读写 API
│   │   ├── embedding.py      # Embedding 模型管理
│   │   ├── reranker.py       # Reranker 模型管理
│   │   └── ...
│   └── services/             # 业务逻辑层
│       ├── rag_service.py    # 核心: retrieve + prompt + LLM
│       ├── rag_graph.py      # LangGraph DAG 编排
│       ├── ingest_service.py # 文件入库 + 分块 + 存储
│       ├── embedding_service.py  # Embedding 模型管理
│       ├── reranker_service.py   # Reranker 模型管理
│       ├── llm_factory.py    # LLM 工厂 (Ollama/OpenAI/Anthropic)
│       ├── heading_chunker.py    # Heading-aware 分块
│       ├── hyde_service.py       # HyDE 预检索
│       ├── multi_query_service.py # Multi-Query 预检索
│       ├── query_rewriter.py     # 多轮对话改写
│       ├── strategy_classifier.py # 策略分类器
│       ├── memory_compression_service.py # 对话记忆压缩
│       └── ...
├── config.yaml               # 运行时配置
├── eval_dataset.json          # 评测数据集
└── eval_results/              # 评测结果
```

**架构模式**：路由层（接收请求） → 服务层（业务逻辑） → 数据层（ChromaDB + SQLite）

**全链路异步**：所有 I/O 操作都是 `async/await`（LLM 调用、数据库读写、文件操作）。

---

### 10.2 前端（Electron + React）

- **Electron**：跨平台桌面应用壳，提供文件系统访问和本机集成
- **React + TypeScript**：UI 组件框架
- **SSE（Server-Sent Events）**：流式回答传输

```javascript
// 前端接收 SSE 流式回答
const eventSource = new EventSource('/chat');
eventSource.addEventListener('token', (e) => {
  const { token } = JSON.parse(e.data);
  appendToChat(token);  // 逐 token 追加到聊天界面
});
eventSource.addEventListener('sources', (e) => {
  const { sources } = JSON.parse(e.data);
  showSources(sources);  // 显示引用来源
});
```

**后端 SSE 实现**（`chat.py:75-131`）：

```python
async def _chat_stream(question, k, pack_id=None):
    # 1. LangGraph prep graph: retrieve + build_prompt
    # 2. 存用户消息到 DB
    # 3. 流式 LLM 调用
    async for token in rag.call_llm_stream(messages, config):
        yield f"event: token\ndata: {json.dumps({'token': token})}\n\n"
    # 4. 发送 sources 事件
    # 5. 存助手回答到 DB
    # 6. 后台触发 memory compression
```

---

### 10.3 其他功能模块

#### File Watcher（文件监听）

> `backend/app/services/file_watcher.py`

使用 `watchdog` 库监听知识目录的文件变化，配合**防抖（debounce）**机制：

```python
DEFAULT_DEBOUNCE_SECONDS = 1.0  # 1秒内的连续事件合并为一次

# 用 threading.Timer 实现防抖
def _schedule_callback(self):
    with self._lock:
        if self._timer is not None:
            self._timer.cancel()     # 取消之前的计时器
        self._timer = threading.Timer(self._debounce_seconds, self._fire)
        self._timer.start()          # 重新开始计时
```

防抖的作用：保存文件时编辑器可能触发多次事件（写入、修改时间更新等），防抖确保只触发一次 re-ingest。

#### Document Summary（文档摘要）

> `backend/app/services/summary_service.py`

LLM 生成文档摘要，结果缓存到数据库。先查缓存，未命中才生成。

#### Spaced Repetition（间隔重复）

> `backend/app/services/spaced_repetition_service.py`

实现 **SM-2 算法** 的闪卡复习调度：

```python
# SM-2 公式
# EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02))
# q = 用户评分 (0-5)

def apply_sm2(self, item, quality):
    q = int(quality)
    new_easiness = item.easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    new_easiness = max(1.3, new_easiness)

    if q < 2:       # 记不住 → 重置
        new_interval = 1
    elif reps == 1:  # 第一次 → 1天后
        new_interval = 1
    elif reps == 2:  # 第二次 → 6天后
        new_interval = 6
    else:            # 之后 → interval × easiness factor
        new_interval = round(item.interval * new_easiness)
```

SM-2 是 SuperMemo 2 算法，广泛用于 Anki 等闪卡应用。核心思想：记得越牢的知识间隔越长复习，记不住的重新开始。

#### Community Service（社区内容）

> `backend/app/services/community_service.py`

从 GitHub 拉取社区内容包的 manifest，支持用户一键导入知识包。

#### Langfuse 可观测性

`rag_service.py` 中可选集成 Langfuse tracing（设置环境变量即可启用），用于监控 RAG pipeline 的每一步调用。

---

## 附录：面试高频问题速查

### 项目概述类

**Q: 简单介绍一下你的项目？**

> "KnowHive 是一个本地优先的个人知识库 + AI 问答系统。用户导入 Markdown/PDF 文档，系统自动分块、向量化、索引。提问时通过 RAG 管线检索最相关的内容，由本地 LLM 生成基于知识库的回答。技术栈是 Electron + FastAPI + ChromaDB + LangGraph，默认使用 Ollama 本地推理，零成本运行。"

**Q: 为什么不直接用大模型回答，要做 RAG？**

> "大模型的知识是训练时冻结的，不包含用户的私有数据。RAG 让模型能基于用户自己的文档回答，而且知识更新只需重新入库，不用重新训练。另外本地小模型参数量有限，RAG 用外部检索弥补了知识容量的不足。"

### Embedding 相关

**Q: 为什么选 bge-m3？**

> "知识库是中英文混合的。bge-m3 是多语言模型（100+语言），用 SentencePiece tokenizer 覆盖中文词汇，1024 维向量精度高。实测从英文 embedding 换成 bge-m3 后，context_precision 从 0.20 提升到 0.71。"

**Q: Embedding 和 TF-IDF 的区别？**

> "TF-IDF 是词袋模型，只看词频，不理解语义。'DP的时间开销' 和 '动态规划的计算复杂度' 用 TF-IDF 几乎没有交集。Embedding 通过 Transformer 编码上下文语义，这两句话的向量会很接近。"

### Chunking 相关

**Q: 你的分块策略是怎样的？**

> "Markdown 文件用 heading-aware chunking，按标题切割保证语义完整。短节（<100字）向下合并防止产生碎片，长节（>1500字）用 RecursiveCharacterTextSplitter 再切。PDF 用固定大小分块（1000字, 200字重叠）。"

### 检索优化相关

**Q: HyDE 和 Multi-Query 各自适合什么场景？**

> "HyDE 适合知识密集型具体问题（'什么是 DP'），把 query-document 的语义鸿沟变成 document-document 匹配。Multi-Query 适合模糊/宽泛/对比类问题（'DP vs 贪心'），扩展查询变体提高召回率。我们实测 Multi-Query 在小知识库（242 chunks）上反而引入噪音，数据量大了才有优势。"

**Q: Bi-Encoder 和 Cross-Encoder 的区别？**

> "Bi-Encoder 独立编码 query 和 document 为向量再比较距离，快但不够精确。Cross-Encoder 把 query 和 document 拼接一起送入 Transformer，attention 直接计算词级交互，精度高但慢。所以我们用两阶段检索：Bi-Encoder 粗筛 → Cross-Encoder 精排。"

### 评测相关

**Q: 怎么评估 RAG 效果？**

> "用 RAGAS 框架做自动化评测。准备 20 个人工标注 QA 对，从 faithfulness（忠实度）、answer relevancy（相关性）、context precision（检索精度）、context recall（召回率）四个维度评估。评估器用独立的 gpt-4o-mini，跟被测 LLM 分开保证客观。最终 Ollama 方案综合 0.76，检索精度 0.82。"

**Q: Ollama 和 OpenAI 差距在哪？**

> "检索指标几乎持平（precision 0.82，relevancy 0.83），唯一差距在 faithfulness（0.72 vs 0.92）。说明小模型的指令遵循能力弱，更容易超出 context 范围'自由发挥'。检索层的优化弥补了 LLM 能力差距。"

### 架构设计相关

**Q: 为什么用 LangGraph？**

> "RAG 管线有多个可选路径（HyDE/Multi-Query/直接检索，Rerank/不Rerank），用 LangGraph 的 StateGraph 通过条件边动态路由，比 if-else 更可扩展可维护。新增策略只需加节点和路由条件，不改已有代码。"

**Q: 为什么用 Electron？**

> "项目定位是本地优先、隐私优先。Electron 提供跨平台桌面应用能力和文件系统访问。数据全部存在本地（ChromaDB + SQLite），不需要上传到云端。"

**Q: 对话记忆怎么实现的？**

> "两层架构：短期记忆保留最近 N 轮完整对话，长期记忆超过阈值后 LLM 压缩成摘要存入数据库。下一轮对话时用压缩摘要 + 最近几轮历史改写用户问题为独立问题，解决多轮对话中的指代消解问题。"
