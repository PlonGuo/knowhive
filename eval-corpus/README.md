# eval-corpus — 第一轮检索评测语料（md only）

按 chunk 策略路由分桶（见 `docs/Corpus-Sources.md` 第 10 节）。每份文件都已用
`chooseStrategy` 验证过实际路由（2026-07-31）。

| 桶 | 实测策略 | 文件 | 问答对 |
|---|---|---|---|
| `a-whole-doc/` | whole-doc | sample_pack 三份 LeetCode 小笔记 | eval_dataset_corpus.json 前 6 条 |
| `b-notes/` | section-as-chunk | learnings 四份 + 三份短文档 | 复用 `backend/eval_dataset.json` |
| `c-long-chapter/` | parent-child | Rust Book ch04/ch16（英）、ES6 教程 async（中） | corpus.json 9 条（跨段落问题） |
| `d-headingless/` | sliding-window | 傲慢与偏见 1–8 章（英）、红楼梦前两回（繁体中文） | corpus.json 5 条（情节细节） |
| `e-table-heavy/` | 表头重复路径 | public-apis 切片（218 表格行）、kubectl 资源表 | corpus.json 5 条（表格行值） |
| `f-big-code/` | 代码按行断路径 | Node stream.md 切片（含 >1000 字符代码块） | corpus.json 3 条（代码行为） |

注意事项：

- Gutenberg 文本的 `-----` 分隔线会被解析成 setext 标题，已手工删除（红楼梦踩过）。
- 红楼梦语料是**繁体**，问答对是简体——同时测繁简跨写法检索；若指标异常先怀疑这里。
- public-apis / stream.md 均为切片（原文 225KB/160KB），切口保证不破坏表格与代码块。
- 大表格问题特意问**表格中后段的行值**（无表头重复必挂）；长章节问题特意**跨段落**
  （逼出 parent 展开价值）。改切分逻辑后这两组是最敏感的信号。
