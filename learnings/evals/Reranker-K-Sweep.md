# 实验记录:Reranker × top-k 检索扫描(k-sweep)

> 2026-07-05。Phase E1(LLM-as-reranker)的后续实验:回答「rerank 后 recall 下降是不是 k 太低造成的」。配套:[Stack-Migration-and-RAGAS-Validation.md](../decisions/Stack-Migration-and-RAGAS-Validation.md) §6。

## 1. 目的(为什么做)

Phase E1 的 RAGAS 复评显示:LLM-as-reranker 让 answer_relevancy +0.12,但 **context_recall 从 0.706 掉到 0.660**。讨论中提出两个假设:

- **H1(挤出机制)**:reranker 只优化「每段对 query 的相关度」,不管覆盖度——多概念 query 下,概念 A 的冗余 chunk 会把概念 B 的唯一 chunk 挤出 top-5,B 的 claim 失去支持 → recall 掉。
- **H2(k 太低)**:k=5 是硬预算,才让挤出效应显形;k 调大后损失应被吸收。

同时想验证一个零成本修复:**coverage prompt**——在精排指令里加一句「多段内容重复时,优先覆盖 query 的不同方面」(MMR 思想的 prompt 版)。

## 2. 过程(怎么做)

- **只测检索双指标**(context_precision / context_recall)——它们只需要 question + contexts + ground truth,**不需要生成答案**,跳过最慢的 llama3.2 答题环节。新脚本 `backend/app/eval_retrieval_sweep.py`。
- **7 组**:rerank {off, on} × k∈{5, 8, 10},外加 coverage prompt @ k=5。同一语料(20 题中文 LeetCode,237 chunks,bge-m3),同一 grader(gpt-4o-mini)。
- rerank on/off 用 PUT /config 热切换;coverage prompt 走 `KNOWHIVE_RERANK_STYLE` 环境变量(rerank.ts 的 style 参数,TDD)。
- **插曲(踩了自己的坑)**:第一轮 sweep 全 0 分——脚本重启 sidecar 时,startup sync 把 knowledge 目录之外的语料判定为「磁盘已删除」,清空了 237 个 chunk。这暴露了一个**继承自 Python sync_service 的真 bug**:Import 按钮导入的外部文件,重启后会从索引里静默消失。已修(sync 只管理 knowledge 目录内的路径)+ 回归测试。语料改放 `data-dir/knowledge/` 后重跑。

## 3. 结果

| 组 | k | context_precision | context_recall |
|---|:-:|:-:|:-:|
| rerank off | 5 | 0.837 | 0.677 |
| rerank off | 8 | 0.825 | 0.766 |
| rerank off | 10 | 0.808 | **0.834** |
| rerank on | 5 | 0.826 | 0.664 |
| rerank on | 8 | 0.797 | 0.807 |
| rerank on | 10 | 0.800 | **0.858** |
| **rerank on + coverage** | **5** | **0.858** | **0.688** |

(与主评同配置组的分差 ~±0.02,即 n=20 单次运行的 grader 噪声量级——解读时以此为噪声底。)

## 4. 读法(学到什么)

1. **H2 成立:recall 主要由 k 驱动**。k 5→10,两条线的 recall 都从 ~0.67 拉到 0.83+。k=5 就是这套 setup 的 recall 瓶颈,不是排序问题。
2. **H1 的挤出效应存在但被高估**:k=5 下 rerank 的 recall 损失只有 -0.013(主评的 -0.046 有一半是噪声)。
3. **意外发现:k≥8 时 rerank 反而提升 recall**(k=8: 0.807 vs 0.766;k=10: 0.858 vs 0.834)。机制:候选池是 20,hybrid 排在 6-20 名的相关 chunk 被精排**捞回**前排——捞回效应盖过挤出效应。rerank 不是 recall 的敌人,固定小 k 才是。
4. **coverage prompt 有效且免费**:k=5 下 precision(0.858,全场最高)和 recall(0.688)双双领先同 k 组。幅度在噪声边缘,但方向与机制预期一致、无任何指标变差、零成本——**已转正为默认 prompt**(`KNOWHIVE_RERANK_STYLE=relevance` 可切回做 A/B)。
5. **precision 随 k 稀释但代价温和**(-0.03 左右/每 +5k)。真正的顾虑在生成侧:k 变大 → context 变长 → 小模型 lost-in-the-middle,faithfulness 可能反受其害——**这是检索指标看不到的,动 k 之前必须跑完整 RAGAS(含生成指标)**。

## 5. 决策

- ✅ coverage prompt 转正为默认(纯赢)。
- ⏸ k 保持 5,**不凭检索指标单方面调大**。若要动 k:跑 k∈{5,8} × 完整 RAGAS(含 faithfulness / answer_relevancy),确认生成质量不掉再改。
- 面试叙事:发现指标退化 → 提出两个机制假设 → 设计便宜的对照实验(跳过生成,7 组 20 分钟)→ 证实/证伪 + 意外发现(rerank 在大 k 下捞回 recall)→ 零成本修复转正 + 高成本改动(调 k)留给带完整指标的后续实验。
