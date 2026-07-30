# 语料来源清单 — 文档导入管线（PDF / docx / txt / md）

> 用途：为「自动化文档导入」功能（DocumentIR + 多格式解析 + OCR）准备评测语料。
> 状态：**待采集**。整理于 2026-07-30。

---

## 0. 先分清两类评测目标

下错数据集是最常见的浪费。这两类数据**不能互相替代**：

| 评什么 | 需要的数据 | 典型数据集 |
|---|---|---|
| **解析器准确率**<br>（版面块切对了没有） | 文档 + **版面标注**（bbox + 类型） | DocBank / PubLayNet / CDLA |
| **RAG 质量**<br>（RAGAS context_recall/precision） | 文档 + **问答对 + reference 答案** | open-rag-bench / 自建 |

**我们主要需要第二类。** 第一类只在想量化「TS 版面 pass vs docling」时才用。

---

## 1. 🥇 优先：自带 query 的一站式 RAG 语料

从这两个开始，能省掉一大半人工造问答对的成本。

| 资源 | 内容 | 链接 |
|---|---|---|
| **vectara/open-rag-bench** | PDF 为主，**已生成好 query**，覆盖 text / table / image 多模态 | https://github.com/vectara/open-rag-bench |
| **udayallu/RAG-Multi-Corpus** | **PDF + Markdown + HTML + DOCX + PPTX 多格式**，企业 RAG benchmark。一个仓库覆盖四种格式 | https://github.com/udayallu/RAG-Multi-Corpus |

---

## 2. PDF —— 按 6 类分支采集

解析路由的每条分支都要有语料覆盖，**包括必须不触发 OCR 的负样本**。

| # | 类型 | 测什么 | 去哪里找 | 优先级 |
|---|---|---|---|---|
| ① | **纯扫描件**（完全无文字层） | OCR 主路径 | FUNSD（199 页扫描表单）https://guillaumejaume.github.io/FUNSD/ ；archive.org 扫描书籍 | 高 |
| ② | **图片型 PDF**（扫描 App 导出、政府表格、教材） | 同上，画质更好 | 同上；或自己手机拍书页 → 扫描 App 导出 | 中 |
| ③ | ⚠️ **坏文字层 / CID 乱码**<br>（有文字层但抽出来是乱码/方框） | **最阴的一档**——字符数探测会「通过」但内容是废的。逼出乱码检测而非只数字符 | **mozilla/pdf.js `test/pdfs/`**<br>https://github.com/mozilla/pdf.js/tree/master/test/pdfs<br>找：`issue2931.pdf` `issue7901.pdf` `issue9534_reduced.pdf` `issue18117.pdf` | **最高**<br>免费、极小、精准 |
| ④ | **双栏学术论文**（有正常文字层） | 版面 pass（分栏 + 阅读顺序重建），不是 OCR | arXiv 随便下，双栏 LaTeX 论文遍地 | 高 |
| ⑤ | **表格密集** | 表格分支（可能证明该砍） | SEC EDGAR 10-K 财报；PubTables-1M；FinTabNet | 中 |
| ⑥ | ✅ **干净单栏数字 PDF** | **负样本**——必须不走 OCR | 任何 Word 导出的 PDF；arXiv 单栏预印本 | 高 |

**补充资源**

- **pdf-association/pdf-corpora** — PDF 语料总索引（含 valid / invalid / 各 ISO 子集）
  https://github.com/pdf-association/pdf-corpora
- **Evil-PDF-Library-for-Qiqqa** — 各种破损状态的 PDF 测试库
  https://github.com/GerHobbelt/Evil-PDF-Library-for-Qiqqa
- **firecrawl/pdf-inspector** — Rust 库，做的正是「检测扫描件 vs 文字型 PDF 以支持智能路由」。**当前在用的 triage 思路的佐证/参考实现**
  https://github.com/firecrawl/pdf-inspector

---

## 3. docx

**docx-corpus** — 73.6 万个真实 .docx，从公开网络采集，按**类型**（legal / forms / reports / policies / educational / technical / administrative …）× **主题**（government / education / healthcare / finance / legal_judicial / technology …）× **76 种语言**筛选。ODC-BY 协议。

- 站点 + 下载：https://docxcorp.us/download
- GitHub：https://github.com/superdoc-dev/docx-corpus
- 也有 HuggingFace dataset + REST API（`api.docxcorp.us`）+ manifest（按 type/topic/language/confidence 过滤后返回 URL 列表）

**采集建议**：`reports` + `technical` 各 10 个足够。docx 的结构信息（Heading1-6 样式、列表、表格）其实比 PDF 干净，主要测 `mammoth` + styleMap → IR 的映射对不对。

---

## 4. txt

| 资源 | 特点 |
|---|---|
| **Project Gutenberg**（gutenberg.org） | UTF-8 纯文本小说，**零结构**，正好测降级路径（全 paragraph，空行切段） |
| **IETF RFC 纯文本**（ietf.org） | 更难的案例：有编号章节、固定缩进、ASCII 表格 —— 「txt 里其实有伪结构」的硬骨头 |

---

## 5. markdown

| 资源 | 特点 |
|---|---|
| 🔴 **本仓库的 `learnings/` 和 `docs/`** | 中英混合、**代码块密集** —— 能直接暴露 [chunker.ts:38](../server/src/chunker.ts#L38) 那个 ``` 代码块内 `#` 开头行被误判成标题的 bug |
| 大型 OSS 文档仓库 | Kubernetes docs / Rust Book / React docs —— 结构规范、代码块多 |
| **firebolt-db/rag_dataset** | HF Transformers 文档的 markdown 版<br>https://github.com/firebolt-db/rag_dataset |

---

## 6. 中文语料

**扫描件中英文都有**（已确认），所以中文 OCR 这条路必须覆盖。

| 资源 | 内容 |
|---|---|
| **buptlihang/CDLA** | 中文文档版面分析数据集，5000 训练 + 1000 验证，10 类标签，labelme 格式（有转 COCO 脚本）<br>https://github.com/buptlihang/CDLA |
| **WenmuZhou/OCR_DataSet** | 中文 OCR 数据集汇总，统一标注格式<br>https://github.com/WenmuZhou/OCR_DataSet |

> ⚠️ **中文 OCR 的技术风险**：tesseract.js 的 `chi_sim` 质量一般，OCR 质量会直接成为整条链路的天花板，可能测出「OCR 分支上了但 context_recall 反而掉」。
> 预案：走 VLM 路线（DeepSeek-VL —— 反正 DeepSeek key 已在 `.env`），或 PaddleOCR（开发期 Python）。
> **中英文各准备一组扫描件，分开出指标** —— 很可能英文能用、中文不能用，那本身就是一个值得写进 learnings 的结论。

---

## 7. 采集量建议

**别贪多。** DocBank 有 50 万页，我们不需要。

```
PDF     6–8 份（6 类各 1–2 份，中英文扫描件分开）
docx    ~10 份
md      ~10 份（含本仓库自己的）
txt     ~10 份
问答对  40–50 个（question + ground_truth，格式照 backend/eval_dataset.json）
```

问答对是最大的人工成本项 —— **先把 open-rag-bench 的现成 query 用上**。

---

## 8. 评测怎么跑

**用检索-only 通道，不跑生成。** 解析和切分只影响检索，跑生成只会把 llama3.2 的弱点混进信号里，还慢还贵。

```bash
cd backend && uv run python -m app.eval_retrieval_sweep \
  --base http://127.0.0.1:18300 --k 5 --label pdf-ir-on \
  --output eval_results/retrieval_sweep.json
```

见 [backend/app/eval_retrieval_sweep.py](../backend/app/eval_retrieval_sweep.py) —— 只算 `context_precision` + `context_recall`。

**再加一个零成本、零方差的确定性指标**：给每个问题标出答案所在的原文片段，检查它有没有被切碎（纯字符串包含检查）。当解析器回归测试比 RAGAS 好用得多 —— RAGAS 做最终质量闸，字符串检查防止改切分改坏。

---

## 9. 相关待办（不属于语料，但同批工作）

- [ ] **Langfuse tracing**（配置已在 `.env`：`LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_BASE_URL`）
  官方 prompt，开工时直接用：
  > Install the Langfuse AI skill from github.com/langfuse/skills and use it to add tracing to this application with Langfuse following best practices.
- [ ] **Phoenix — 决定不做**（与 Langfuse 重叠 ~70%，独有的 embedding UMAP 是一次性诊断，不值得进架构）
- [ ] **Python 定位：仅开发期**。用 docling / PyMuPDF 产出结构化 ground truth 当 oracle，对照开发 TS 解析器；不进 `.app` 打包（`tauri.conf.json` 只打包 `binaries/bun` + `resources/server`）
- [ ] **知识库路径改存相对路径**（`documents.file_path` / `chunks.file_path` 现在存绝对路径，见 [store.ts:42](../server/src/store.ts#L42)）
- [ ] **向量索引扩展性基准** → `learnings/evals/Vector-Index-Scaling.md`
