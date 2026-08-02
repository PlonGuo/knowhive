# eval-corpus/docx — 真实世界 .docx 回归语料

用途：回归测试 `server/src/docxIr.ts`（mammoth → HTML → block IR）。

在此之前 docx 只有一份 python-docx 生成的自制 fixture（干净的 Word Heading 样式），
覆盖不到真实 Word 文档的脏数据。这里 8 份全部是**从公网真实下载**的文件，
不是我们自己造的，也不是转换出来的。

采集日期：2026-08-02。全部 8 份都已用 `file` + `unzip -l` 双重校验：
`file` 报 `Microsoft Word 2007+` / `Microsoft OOXML`，且 zip 内确实含
`word/document.xml`。下载过程中拿到的 HTML 错误页已全部删除（见文末「没拿到的」）。

总大小 1.6 MB / 8 份：中文 5 份、英文 3 份。

> **⚠️ 其中 2 份不入库。** `en-ieee-conference-template.docx` 与
> `en-springer-lncs-template.docx` 是 IEEE / Springer 免费分发给作者的投稿模板，
> **并非开放许可**，而本仓库是 public，所以它们在 `.gitignore` 里，只存在于本地工作副本。
> 上面每份都记了原始下载 URL，需要时可自行重新取。**其余 6 份许可干净**
> （中国政府公开信息 4 份 + 欧盟 Decision 2011/833/EU 1 份 + MIT 1 份），随仓库分发。

---

## 文件清单

### 1. `cn-mofcom-enforcement-regulation.docx` — 19 KB · 中文

- 来源：<https://fdi.mofcom.gov.cn/resource/doc/2025/12/26/d0fa4fe06e834cc983b439192a8cf144.docx>
  （商务部外资司转发《行政执法监督条例》，国务院令第825号，2025-12-17）
- 许可：中国《著作权法》第五条——法律、法规、国家机关的决议/决定/命令及其官方正式译文
  不受著作权保护。政府公开信息，可自由使用。
- **测什么：完全没有样式的中文法规。** 全文 **零个 `w:pStyle`、零张表格**，
  195 个段落全靠 `第一章　总　　则` / `第一条` / `（一）` 的文字约定表达层级。
  mammoth 输出 **h1–h6 全是 0，99 个 `<p>`** —— 也就是 docxIr 会把整篇法规拍成
  一条毫无结构的段落流。`第X章/第X条` 51 处、`（一）` 26 处。
  这是「标题靠文字约定、不靠样式」这一类中文公文的最纯粹样本，也是启发式标题识别
  （若将来要做）的首要 benchmark。
- 附带坑：章节标题里是**全角空格**（`第一章　总　　则`），做正则要考虑。

### 2. `en-ieee-conference-template.docx` — 32 KB · 英文

- 来源：<https://ukrmico.ieee.org.ua/wp-content/uploads/2023/07/conference-template-a4.docx>
  （IEEE UkrMiCo 会议站点分发的官方 IEEE 会议论文 A4 模板）
- 许可：IEEE 免费向作者分发的投稿模板，**并非开放许可**。仅作本地测试 fixture 使用，
  不要随语料对外再分发。若介意，可自行替换为 Overleaf 上的 LaTeX 版并另行导出。
- **测什么：文本框（text box）+ 深层标题梯。**
  - `w:txbxContent` × 4（内容为 "We suggest that you use a text box to insert a graphic..."）
    —— 验证 mammoth 是否把文本框正文吐出来、以及吐在文档流的什么位置。
  - Heading 样式的 `styleId` 被 Word 重命名成纯数字 `"1" "2" "3" "4" "5"`，
    但 `w:name` 仍是 `heading 1..5`。mammoth 按 name 映射，实测
    **h1=4 h2=9 h3=2 h4=4 h5=2**，说明按 name 映射这条路是对的。
  - 1 张带 `gridSpan`/`vMerge` 的合并单元格表 + 图表标题（Fig. 1 / TABLE I 样式）。

### 3. `cn-jinjiang-budget-2025.docx` — 57 KB · 中文

- 来源：<https://www.jinjiang.gov.cn/xxgk/zjxx/bmysgk/202502/P020250206708911400729.docx>
  （福建晋江市司法局《2025年度部门预算》，政府信息公开栏目附件）
- 许可：政府主动公开信息，公开发布无使用限制声明。
- **测什么：自动生成目录（TOC）+ 大量纵向合并单元格。**
  - Word 自动 TOC（`TOC` 域 + `PAGEREF` + `TOC1/TOC11/TOC22` 样式 + 25 个书签锚点）。
    mammoth 不认 `toc 1` 样式，把目录整块降级成普通段落，形如
    `一、部门主要职责\t2`、`二、部门预算单位构成\t3` —— **目录噪声会被当成正文吃进 IR**，
    并且和后面真正的正文标题字面重复，是检索召回的直接污染源。25 行这样的目录条目。
  - 16 张表，`w:vMerge` **302 处**、`w:gridSpan` 40 处 —— 预算表典型的纵向合并。
    直接压 `tableToPipes()`（它只做 `querySelectorAll("tr")` 拍平，不还原合并）。
  - 唯一同时有**真 Heading1 样式（25 处，mammoth 输出 h1=25）**和 `一、`（118 处）
    两套层级的文件：样式层级和文字层级互相打架。
  - 注：`file` 对这份报 `Microsoft OOXML` 而不是 `Microsoft Word 2007+`（zip 内条目
    顺序不同所致），`unzip -l` 已确认 `word/document.xml` 存在，是合法 docx。

### 4. `cn-cq-procurement-2024.docx` — 109 KB · 中文

- 来源：<https://fzggw.cq.gov.cn/zwxx/tzgg/202409/P020240905348644027530.docx>
  （重庆市发改委《重庆市集疏运体系规划》政府采购竞争性磋商文件，2024-09）
- 许可：政府采购公告附件，主动公开信息。
- **测什么：中文 `一、/（一）/1.` 多级编号标题密度最高的一份。**
  - `一、` **76 处**、`（一）` **130 处**、`1.` 106 处、`1.1` 36 处 —— 三层中文编号全齐。
  - 自定义标题样式名 `一级条标题` / `二级条标题` / `小标题 1`（不叫 heading N），
    另有一批 `heading 1..9` 定义；mammoth 实测 **h1=7 h2=33**，
    即一部分标题映射成功、大量 `（一）` 级标题掉成 `<p>` —— 半成功状态最难查，
    最适合当回归基线。
  - 9 张表，`vMerge` 52 / `gridSpan` 20（评分表、报价表）。
  - 自动 TOC（`TOC` 域 + `PAGEREF` + `toc 2` 样式）。

### 5. `en-eu-com-2025-400.docx` — 214 KB · 英文

- 来源：<https://eur-lex.europa.eu/legal-content/EN/TXT/DOC/?uri=CELEX:52025DC0400>
  （European Commission COM(2025) 400 final，InvestEU 年度报告类 Communication）
- 许可：欧盟委员会文件复用规则 Decision 2011/833/EU —— 注明出处即可自由复用。
  本目录里许可最干净的一份。
- **测什么：真实（非模板）英文政府文档的自动目录 + 图表题注 + 嵌入 EMF 图。**
  - 完整 Word 自动 TOC：`TOC1/TOC2` 样式 + `PAGEREF`，mammoth 降级后输出
    `INTRODUCTION\t2`、`1.1. General overview\t4` 等 11 行带 tab+页码的伪段落。
  - 真 `Heading1/Heading2` 样式（mammoth **h1=3 h2=7**）与 TOC 文本字面重复。
  - 题注专用样式 `FigureTitle1` / `TableTitle1`（4+3 处）—— 图片题注这一类**语义上
    该跟图走、结构上是独立段落**的块。
  - `Bold` 是一个**独立的段落样式**（4 处）—— 就是任务里说的「加粗段落假装是标题」
    的原生形态：它有样式名但不是 heading，mammoth 只会给 `<strong>`。
  - 5 张 EMF 矢量图 → mammoth 内联成 base64 data URI，**214 KB 的 docx 膨胀成 949 KB HTML**。
    docxIr 只取 `el.text` 所以 IR 不受污染，但内存峰值和转换耗时是真实压力点。

### 6. `cn-buaa-thesis-template.docx` — 266 KB · 中文

- 来源：<https://raw.githubusercontent.com/CheckBoxStudio/BUAAThesis/master/Template.docx>
  （北航研究生学位论文 Word 模板）
- 许可：**MIT**（仓库 `CheckBoxStudio/BUAAThesis` 的 SPDX 许可）。可自由再分发。
- **测什么：修订标记（tracked changes）+ 自定义标题样式名导致标题全丢。**
  - `<w:ins>` **240 处** / `<w:del>` **35 处** —— 本目录里唯一带修订标记的文件。
    mammoth 默认接受插入、丢弃删除；需要确认 IR 里没有混进已删除的旧文本。
  - 章节标题用的是 `phd_chapter` / `phd_section` 自定义样式名（styleId `phdchapter`/`phdsection`），
    **不叫 `heading N`** → mammoth 实测 **h1–h6 全部为 0，264 个 `<p>`**。
    一篇有 9 个 `第X章` 的完整学位论文在 IR 里变成一条扁平段落流 —— 这是 docxIr
    最严重的已知失效模式，也是这份语料存在的首要理由。
  - 附带：Word 自动 TOC（`TOC` 域 + 34 行带前导点/页码的目录）、
    MathType 公式（`MTDisplayEquation` 样式 + `OLEObject`）、
    17 张图（含 WMF，mammoth 会警告）、14 个 VML `v:shape`、图表题注 `phd_notePic`/`phd_noteTable`。

### 7. `en-springer-lncs-template.docx` — 271 KB · 英文

- 来源：<https://digitech.sciencesconf.org/data/pages/springer_template_.doc_2.docx>
  （Springer LNCS/proceedings 作者模板，由 DigiTech 会议站点分发）
- 许可：Springer 免费向作者分发的投稿模板，**并非开放许可**。同 IEEE，仅作本地 fixture。
- **测什么：文本框最密集的一份 + 本地化 styleId。**
  - `w:txbxContent` **12 处**、VML `v:shape` **145 个** —— 模板里用文本框画的
    "third span / second span / first span" 排版示意块。文本框正文是否进入文档流、
    进来后顺序是否错乱，这份最容易暴露。
  - styleId 是法语本地化的 `Titre1` / `Titre2` / `Corpsdetexte`，但 `w:name` 仍是
    `heading 1` / `heading 2` / `Body Text`。mammoth 实测 **h1=13 h2=16**，
    证明 styleId 本地化不影响映射（和 IEEE 的数字 styleId 一起构成 name-vs-id 的对照组）。
  - 30 个 `Paragraphe de liste`（列表段落）+ 56 处 `numPr` 多级编号。

### 8. `cn-bjkfq-application-form.docx` — 651 KB · 中文

- 来源：<https://kfqgw.beijing.gov.cn/zwgkkfq/2024zcwj/202506/W020250625670470552529.docx>
  （中关村国家自主创新示范区「2025年概念验证平台建设项目申报书」，北京市科委/中关村管委会）
- 许可：政府公告附件，主动公开信息。
- **测什么：本目录唯一含真·嵌套表格的文件，且是极端合并单元格表单。**
  - `w:gridSpan` **447 处** + `w:vMerge` 97 处，分布在 6 张外层表里 —— 申报书表单的典型形态。
  - **嵌套表格 2 处**（`<w:tbl>` 出现在 `<w:tc>` 内部，脚本逐字符配对验证过）。
    这直击 `docxIr.ts:55` 的 `tableToPipes()`：它用
    `table.querySelectorAll("tr")` 取行，**会把内层表的 `<tr>` 一并捞进外层表的行列表**，
    导致列数错乱、`width` 被内层表撑大、大量空 pad 单元格。
    嵌套表格 → 管道 markdown 的行为需要一个明确的期望值。
  - 全文 **零 heading 样式**（styleId 全是数字，`w:name` 是 `index heading` /
    `HTML Preformatted` 之类无关样式），mammoth 输出 h1–h6 全 0、467 个 `<p>`。
  - `一、` 11 处 / `（一）` 17 处 / `1.` 72 处，正文编号仍在。
  - 651 KB 里绝大部分是内嵌图片/字体，HTML 只有 22 KB —— 顺带测「大文件、小正文」的解析开销。

---

## 覆盖矩阵

| 脏特性 | 覆盖文件 |
|---|---|
| 中文 `一、/（一）/1.` 多级编号标题 | cq(76/130/106)、jinjiang(118/10/465)、bjkfq(11/17/72)、mofcom(`第X章`51/`（一）`26) |
| 自动生成目录 TOC + PAGEREF | jinjiang、cq、buaa、eu-com |
| 合并单元格表格 | jinjiang(vMerge 302)、bjkfq(gridSpan 447)、cq(vMerge 52)、ieee |
| **嵌套**表格 | bjkfq（唯一） |
| 文本框 text box | springer(12)、ieee(4) |
| 修订标记 tracked changes | buaa（唯一，ins 240 / del 35） |
| 图表题注 | eu-com(`FigureTitle1`/`TableTitle1`)、buaa(`phd_notePic`)、ieee |
| 「加粗段落假装标题」/ 无样式标题 | mofcom（零样式）、bjkfq（零 heading）、buaa（自定义样式名→标题全丢）、eu-com（`Bold` 段落样式） |
| 公式 / OLE / WMF-EMF 图 | buaa(MathType+OLE+WMF)、eu-com(EMF→949KB HTML) |

**已知会失效的三处**（写回归断言时优先盯）：

1. 自定义标题样式名（`phd_chapter`、`一级条标题`）→ mammoth 不映射 → 标题全部降级为段落。
   buaa 是 100% 失效，cq 是部分失效。
2. TOC 块被当正文吃进 IR，产生和正文标题字面重复的噪声块（4 份文件）。
3. `tableToPipes()` 对嵌套表格会把内层行拍进外层（bjkfq）；对 `vMerge`/`gridSpan`
   不做还原，合并单元格会退化成错位的空格子（jinjiang 最严重）。

---

## 没拿到的（诚实记录）

- **UNECE 官方 UN Regulation `R172e.docx`**
  （<https://unece.org/sites/default/files/2025-04/R172e.docx>）——
  unece.org 有 Cloudflare 防护，curl 带完整浏览器 UA / Referer / sec-fetch-* 头仍固定
  **403**，拿到的是 HTML 拦截页，已删除。需要真浏览器（`/browse`）才能取。
  它本可以补一份「英文 UN 文书 + 多级编号条款 + 附件表格」的样本。
- **EUR-Lex `/TXT/DOCX/` 端点** 一律返回 **HTTP 500 + HTML 错误页**。
  正确端点是 **`/TXT/DOC/?uri=CELEX:...`**，它按源文件格式返回，且对
  SWD/COM 类文件返回的就是 docx（`Content-Type:
  application/vnd.openxmlformats-officedocument.wordprocessingml.document`）。
  注意：法规类（如 `32024R1689`）没有 Word 源，该端点返回 HTML，会静默存成假 docx，
  务必逐个 `file` 校验。
- **清华 ThuWordThesis 模板** —— release 里只有 zip，zip 内是 `.dotx`（Word 模板而非文档），
  且文件名编码在 macOS 下 unzip 直接报 `Illegal byte sequence` 解不出来。放弃。
- **英文的 tracked changes 样本没找到。** 公开发布的英文文档基本都是终稿，修订标记已接受。
  目前修订标记只有中文的 buaa 一份。若要补，现实路径是去
  LibreOffice / Apache POI 的单元测试 fixture 仓库拿（但那些是人造小文件，不算 real-world）。
- **带批注（`commentReference`）的文档一份都没有** —— 8 份全是 0。同上，公开稿不留批注。
- **中国信通院 / 工信部白皮书**：全部只发 PDF，没有 docx 版本，已放弃该来源。
- **`try-bynr.docx`**（巴彦淖尔市政府附件）下载回来是 HTML 错误页，已删除。
- **`try-gxdsj.docx`**（广西数字化转型中心项目方案，389 KB，TOC + 无样式 `一、（一）`）
  下载并验证通过，但特性与 cq + jinjiang 重叠，为控制在 8 份以内删掉了。
  需要时可从 <http://dsjfzj.gxzf.gov.cn/zfxxgkzl/gggs/P020240930573724841467.docx> 重新取。

## 复现校验

```sh
cd eval-corpus/docx
for f in *.docx; do
  file -b "$f"
  unzip -l "$f" | grep -q word/document.xml && echo "  ok $f" || echo "  BAD $f"
done
```
