# pdf-ir — PDF 语料的 DocumentIR 快照（B 轮 RAGAS）

由 `knowhive-pdf` 插件（v0.1.1 + CJK 空格修复）解析真实 PDF 产出的 IR JSON。
原始 PDF 不入库（progit 20MB），来源如下，可随时重新解析：

| 文件 | 来源 | 覆盖特征 |
|---|---|---|
| `bert-two-col.ir.json` | arxiv.org/pdf/1810.04805 | 双栏排版、GLUE 大表格 |
| `attention-single-col.ir.json` | arxiv.org/pdf/1706.03762 | 单栏、复杂度表格 |
| `umap-math.ir.json` | arxiv.org/pdf/1802.03426 | 公式密集 |
| `caict-ai-whitepaper.ir.json` | caict.ac.cn 《人工智能白皮书(2022)》 | 中文 Word 排版、一/（一）/1. 编号层级 |
| `progit-zh.ir.json` | github.com/progit/progit2-zh releases | 中文 501 页长书、代码块 755 个、git log 表格 |

问答对：`backend/eval_dataset_pdf.json`。导入评测库用
`server/scripts` 侧的 ingestIR 通道（IR 直接进 chunk→embed→store）。
