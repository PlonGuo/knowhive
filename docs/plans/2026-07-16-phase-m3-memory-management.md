# Phase M3: Memory 管理 UI + Procedural 记忆 + 淘汰 + episodic 工具

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务实施。

**Goal:** 记忆系统收尾：用户可见可控（管理 UI）、procedural 偏好自动学习并常驻注入、
LRU/TTL 淘汰防膨胀、episodic 通过 agent 工具可检索。存储不变（bun:sqlite 单文件）。

**顺序依据**（用户确认）：管理 UI → procedural → 淘汰 → episodic 利用（价值递减）。

## Task 0（TDD）：memories 管理 API
- `server/src/memoryRoutes.ts`（DI: db, embedFacts）：GET /memories?kind=、
  DELETE /memories/:id、PUT /memories/:id（改 content → 重嵌入）
- Commit: `feat(memory): memories management API`

## Task 1：Settings 记忆管理卡
- SettingsPage 加 "Memory" 卡：列 semantic+procedural（kind 徽标 + 内容 + 删除钮 +
  行内编辑）;空态文案。testid: memory-list / memory-item-N / memory-delete-N
- Commit: `feat(ui): memory management section in settings`

## Task 2：procedural 记忆
- 蒸馏 prompt 升级：输出 `{summary, facts, preferences}`——preferences 是「该怎么服务
  用户」的持久指令（语言/风格/水平）。few-shot 示例同步扩（保持离题领域）;parse fail-open
- procedural 无需 embedding（无条件注入）;session 模式下每次对话注入 system
  （「Standing instructions from the user」块）;stateless 请求不注入（评估兼容）
- 与 custom_system_prompt 的关系：并存——custom 是用户手写的全局项，procedural 是学来的
- Commit: `feat(memory): procedural memory — auto-learned standing instructions`

## Task 3（TDD）：淘汰
- memories 加列 `last_recalled_at`（迁移;召回时 UPDATE）
- 纯逻辑 `selectEvictions(rows, policy, now)`：semantic 超上限(200)删最久未召回;
  episodic 超 TTL(90天)删除;procedural 不自动删（只有用户删）
- 启动时 + 每次蒸馏后跑;删除量 log
- Commit: `feat(memory): LRU/TTL eviction`

## Task 4：episodic 检索工具（agentic）
- agent 工具 `search_history(query)`：LIKE 匹配 episodic content，返回最近 5 条
  {question, answer 摘,时间};挂进 buildAgentTools（session 模式下才有意义,无 session
  时工具返回空提示）
- Commit: `feat(agent): search_history tool over episodic memory`

## Task 5：收尾
- 真机验证：设偏好被学到并常驻;管理 UI 删改;HANDOFF + learnings 附记
- Commit: `docs: Phase M3 complete`

## Verification
每 task：`cd server && bun test` + `bun run test` + tsc;Task 5 真机闭环。
