# knowhive-pdf

KnowHive 的 PDF 解析插件：用 [docling](https://github.com/docling-project/docling)
把 PDF 解析成 KnowHive 的 DocumentIR JSON（`server/src/documentIr.ts` 的形状），
通过 stdio 协议供主程序调用。主程序保持 single runtime——本插件经
`uv tool install knowhive-pdf` 按需安装，不装则主程序完全无感。

> 开发期暂驻主仓库 `pdf-plugin/`；发布时整体迁出为独立 repo + PyPI +
> GitHub Actions Trusted Publishing。

## 协议

```
$ knowhive-pdf --stdio
→ {"type":"ready","schema_version":1,"plugin_version":"0.1.0","docling_version":"..."}
← /path/to/file.pdf
→ {"type":"result","path":"...","ir":{"format":"pdf","blocks":[...]}}
→ {"type":"error","path":"...","code":"needs_ocr|bad_text_layer|parse_failed","message":"..."}
```

调试用一次性模式：`knowhive-pdf file.pdf`。

## v1 范围与设计决定

- **不含 OCR**（`do_ocr=False`）。扫描件由 triage 拦截返回 `needs_ocr`；中文 OCR 留 v2。
- **triage 先行**（pypdfium2，毫秒级）：每页字符中位数 <50 且页面含图 → `needs_ocr`；
  无图或乱码字符占比 >10% → `bad_text_layer`。坏文字层是最阴的静默失败——页面渲染
  正常但抽出来是空/乱码（校准样本：pdf.js `issue9534_reduced.pdf`）。
- **NFKC 归一化**：子集化中文字体会把部分汉字映射到康熙部首码位（⼀ U+2F00 ≠ 一
  U+4E00），肉眼相同、检索必死。所有输出文本过 NFKC。
- **标题层级从编号推导**（"3.1"→L3）：docling 的 section_header 是平的。
- **表格 caption 拆分**：docling 的表格 markdown 前缀 caption；拆成独立段落块，
  表格块从表头行开始——主程序 `splitTable()` 的表头重复逻辑依赖"首行=表头、
  次行=分隔行"。

## 开发

```bash
uv sync
uv run pytest                      # 快速套件（不加载 docling 模型）
KNOWHIVE_PDF_SLOW=1 uv run pytest  # 含完整 docling 解析（首跑下载版面模型）
```

`tests/fixtures/bad-textlayer.pdf` 来自 mozilla/pdf.js 测试语料（issue9534_reduced）。
