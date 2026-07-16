# Phase H: 写工具 + 权限系统（fail-closed，AI SDK 原生审批流）

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务实施。

**Goal:** agentic chat 获得 create/update/delete 笔记能力，由三档 fail-closed 权限模式
守门：写操作默认逐次审批（Claude Code 式 Allow/Deny），删除即使在放行模式下也必须确认。

**API 事实（.d.ts 侦察实测）**：`streamText({toolApproval: {tool: 'approved'|'user-approval'|
'denied'|fn}})`;暂停时发 `tool-approval-request{approvalId, toolCall}` chunk、finishReason=
'tool-calls' 结束本流;客户端 `addToolApprovalResponse({id, approved})` + `sendAutomaticallyWhen:
lastAssistantMessageIsCompleteWithApprovalResponses` 自动续传;服务端下一请求经
`convertToModelMessages` 把 approval-responded parts 转成 ToolApprovalResponse 自动恢复执行;
拒绝 → `tool-output-denied` chunk / output-denied state。可选 HMAC 签名防伪造（H2 再说）。

**关键集成点**：现 chatRoutes 手动映射消息且 session 模式忽略客户端数组——审批续传请求必须
改走 `convertToModelMessages(messages, {tools})`（tool parts 需要完整往返）。判定方式：
服务端对 body.messages 跑 `lastAssistantMessageIsCompleteWithApprovalResponses`。
**持久化门**：onFinish 只在 finishReason==='stop' 时 persist（审批暂停的首请求不落库,
续传完成时 question 仍在客户端 messages 里,一次落齐）。

## 设计
- config 加 `chat_permission_mode: 'ask'|'accept-edits'|'readonly'`，默认 **ask**（fail-closed）
- 权限矩阵（纯函数 `toolApprovalFor(mode)`）：
  | 工具 | ask | accept-edits | readonly |
  |---|---|---|---|
  | 只读四件套 | approved | approved | approved |
  | create/update_note | user-approval | approved | **不挂载** |
  | delete_note | user-approval | **user-approval**（破坏性永远问） | 不挂载 |
- 写工具复用 knowledge 写逻辑 → 先从 knowledgeRoutes 提取 `writeNote/createNote/deleteNote`
  进 knowledge.ts（服务函数,routes 与工具共用）
- 前端：approval-requested part → 工具行变成 Allow/Deny 按钮卡;output-denied 渲染「已拒绝」;
  Settings 加权限模式三选;写工具 label（Creating/Updating/Deleting: path）

## 任务
- **Task 0（TDD）**：knowledge.ts 提取写服务函数（createNote 新增,现 PUT content 只支持已存在
  文件）+ knowledgeRoutes 改用之;权限矩阵纯函数 `server/src/permissions.ts`
- **Task 1（TDD）**：agentTools 加三个写工具（注入服务函数,错误返回值,输出紧凑）
- **Task 2**：chatRoutes 集成——按模式挂载写工具 + toolApproval 配置;审批续传分支
  （convertToModelMessages）;持久化门 finishReason==='stop';Mock 集成测试（approve 路径 /
  deny 路径 / readonly 不挂载 / ask 模式发出 approval-request chunk）
- **Task 3**：前端——ToolActivity 审批态（Allow/Deny → addToolApprovalResponse）+
  sendAutomaticallyWhen;denied 态;Settings 权限模式选择;chat.test 扩 approval chunks
- **Task 4**：真机 e2e（agentic 让模型建/改/删笔记,Allow 与 Deny 都走一遍;accept-edits 下
  delete 仍拦）+ HANDOFF/learnings 收尾

## Verification
每 task 双侧 suite + tsc;Task 4 真机走通 审批/拒绝/放行模式/删除强确认 四条路径。
