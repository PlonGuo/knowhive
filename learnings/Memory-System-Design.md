# Memory System 设计与实现 — Phase M（M1+M2）

**日期**: 2026-07-16 · **范围**: 多会话持久化 + 短期窗口/水位线压缩 + episodic 落库 +
semantic 蒸馏与跨会话召回（procedural 记忆与 TTL 淘汰留给 M3）

## 分层架构

| 层 | 机制 | 对照 Claude Code |
|---|---|---|
| 短期原文 | 最近 N 轮(chat_memory_turns=6)原文进 messages | 未压缩的对话尾部 |
| 短期压缩 | 未摘要消息 > threshold(20) → LLM 摘要 + 水位线推进 | auto-compact |
| episodic | 每轮问答 trace(question/answer/sources)落库 | transcript 持久化 |
| semantic | 蒸馏出的持久事实 + embedding，问题相似度召回(top3, ≥0.5)注入 system | MEMORY.md 记忆 |

水位线机制承自旧 Python 栈(memory_compression_service.py)：`MAX(last_message_id)`
即压缩边界，避免重复摘要——迁移时此功能未移植，本 phase 在 TS 栈重建并扩展。

## 核心设计决策

1. **蒸馏搭压缩的顺风车**：语义事实的提取不单独调 LLM——压缩本来就要让模型读旧消息，
   一次调用同时产出 `{summary, facts[]}`。长期记忆的边际成本 = 0 次额外 LLM 调用。
2. **服务端历史为真相源**：session 模式下忽略客户端的 messages 数组（只取最新问题），
   上下文由服务端组装（窗口+摘要+召回）——客户端状态不可信，也为将来 memory 策略
   演进留主权。
3. **hooks 全部 fire-and-forget fail-open**：持久化/压缩/蒸馏失败只 log，绝不打断聊天流。
4. **无 session_id 字节级兼容**：评估管线和旧测试零改动。

## 踩坑记录（都有测试钉住）

1. **小模型蒸馏偷懒**：llama3.2 对 "return [] if none" 的响应是永远返回 `[]`（事实全塞进
   summary）。修法：few-shot 示例。
2. **few-shot 示例泄漏**：加了示例后模型把示例里的事实原样抄进输出——「用户目标是年底
   进大厂」被存进了从没说过这话的用户的记忆库。修法：示例换成**离题领域**（烹饪）+
   明确"facts must come ONLY from the segment"。离题泄漏即使发生也容易发现，且 embedding
   距离远、几乎不会被召回——**污染的破坏力取决于它和真实查询的相似度**。
3. **重复蒸馏**：多次压缩会重新推导出相同事实 → 入库前按内容精确去重。

## 真机闭环验证（llama3.2）

- 会话 A 陈述个人事实 → 超阈值触发压缩 → 蒸馏出 3 条准确事实（零泄漏零虚构）
- **全新会话 B 问「我在准备哪家公司的面试」**（知识库无此信息）→ 正确召回 Rippling +
  Python 刷题 —— 长期记忆跨会话闭环
- 重启后会话/标题/记忆全部持久

## M3 待办

procedural 记忆（用户偏好注入 system prompt）、TTL/rolling 淘汰、记忆管理 UI（查看/删除
已存事实——隐私角度这个其实该早做）、episodic 的检索利用。

**面试点**: 「长期记忆最贵的是蒸馏调用，我把它挂在压缩的顺风车上——同一次 LLM pass 产出
摘要和事实，边际成本为零。另一个值得讲的是 few-shot 泄漏：示例事实被小模型抄进用户记忆库，
我的修法不是删示例而是把示例换到离题领域，让泄漏『既可检测又无害化』——因为污染的危害
正比于它与真实查询的 embedding 相似度。」

## M3 附记（2026-07-16）

管理 UI（Settings Memory 卡：fact/rule 徽标、行内编辑、删除）、procedural 记忆
（蒸馏第三键 preferences → 无条件注入 system）、LRU/TTL 淘汰（semantic 上限 200 按
最近召回淘汰、episodic 90 天 TTL、**procedural 永不自动删**——常驻指令只能由用户删）、
agent `search_history` 工具（episodic 关键词检索，仅 session 模式挂载）。

新增两个小模型对抗样本：①字面 `"[]"` 被当作偏好字符串入库（括号垃圾过滤）；②空数组
示例教会模型偏好栏永远留空、指令全进 facts（第二个 few-shot 示例修，且示例偏好刻意
**作用域受限**——无条件注入的东西，泄漏时的危害必须被设计成惰性的）。

未做：记忆管理 UI 的手动新增（编辑/删除已有）；episodic 定期回顾蒸馏。
