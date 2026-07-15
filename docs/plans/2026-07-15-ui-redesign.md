# UI Redesign Implementation Plan（Phase UI）

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务实施。

**Goal:** 全 UI 重构——混合风格主题（暗色 Claude 暖 / 亮色 OpenAI 冷）+ 手动 dark mode +
React Bits DotGrid 全局互动背景（Google Stitch 观感），覆盖布局壳/Chat/Settings/Onboarding/FileTree。

**Architecture:** 现有 HSL token 体系保留（组件类名大部分不动，换 token 值即变脸）；
`darkMode: ['class']` 已配好但无切换器——补 ThemeProvider + 持久化。DotGrid 作为固定
背景层（canvas + gsap InertiaPlugin），内容面板半透明 + backdrop-blur 悬浮其上。

**Tech Stack:** Tailwind（现有）+ gsap（新增，DotGrid 依赖）+ motion（已有）。
上游源码已取：`scratchpad/DotGrid-upstream.tsx`（react-bits DotGrid-TS-TW）。

**用户已定决策**（项目记忆 project_ui_redesign）：混合风格；DotGrid 全局；dark mode 手动
切换+持久化；WKWebView 性能约束（空闲降帧/暂停 + prefers-reduced-motion）。

---

## 设计 token（两套主题的具体色板）

**Light = OpenAI 冷**：近白底（0 0% 99%）、近黑主色（240 9% 12%，按钮同 OpenAI 黑）、
中性灰 border/muted、极简。
**Dark = Claude 暖**：暖深底（48 6% 12% ≈ #211f1c）、奶油前景（46 27% 94% ≈ #f2f0e8）、
**terracotta 主色**（16 58% 58% ≈ #d97757）、暖灰面板（46 5% 17%）。
共同：`--radius: 0.75rem`（更柔）；标题用 `font-serif`（ui-serif/Georgia，离线安全）仅暗色
Claude 气质页（Onboarding hero、空态）。
DotGrid 配色跟主题：light base #d9d9de / active #18181b；dark base #3a3833 / active #d97757。

## Task 0：主题系统基座（TDD 纯逻辑部分）
- Create: `src/lib/theme.ts` — `type Theme = 'light'|'dark'`；`getInitialTheme(storage, prefersDark)`
  （存储优先→系统偏好回退）、`applyTheme(theme, root)`（切 .dark class）、`persistTheme`。纯函数注入依赖可测。
- Test: `tests/src/theme.test.ts`（存储优先/回退/往返）
- Modify: `src/index.css` 两套 token 全量替换（上面色板）+ `--radius` 0.75rem
- Modify: `src/App.tsx` 启动时 apply；`src/components/layout/StatusBar.tsx` 加 ☀/☾ 切换钮
  （data-testid="theme-toggle"，点击 apply+persist）
- 验证：`bun run test` 绿（新 theme 测试 + StatusBar 测试）；tauri:dev 肉眼两套色板
- Commit: `feat(ui): theme system — Claude-warm dark / OpenAI-cool light + toggle`

## Task 1：DotGrid 全局背景层
- `bun add gsap`
- Create: `src/components/reactbits/DotGrid.tsx` — 适配上游：①颜色从 props 改为随主题
  （观察 documentElement class 变化或由父组件传 theme 重渲）②**空闲暂停**：pointer 活动
  设 activeUntil=now+2.5s，rAF 循环里无位移且过期→跳过 draw（省电核心）③respect
  `prefers-reduced-motion`：只画静态点阵不装监听④devicePixelRatio 上限 2
- Modify: `src/App.tsx`（或 AppLayout）：`<div className="fixed inset-0 -z-10"><DotGrid/></div>`;
  内容层加 z-0/z-10 分层
- 面板半透明：AppLayout main 区、Sidebar 面板 `bg-background/75 backdrop-blur-md`
  （具体在 Task 2 统一做，本 task 只保证背景可见不糊字）
- 验证：vitest 绿（DotGrid 在 happy-dom 下 canvas 缺 API 需 guard——getContext 返回 null 时静默不画）;
  tauri:dev 肉眼：点阵随鼠标推开回弹、切主题变色、静置 CPU 占用回落
- Commit: `feat(ui): React Bits DotGrid interactive background (gsap), theme-aware + idle-pause`

## Task 2：布局壳重构（AppLayout / Sidebar / StatusBar）
- 悬浮面板式布局：外层 padding + 面板 `rounded-xl border bg-background/75 backdrop-blur-md`;
  Sidebar 变悬浮卡（Claude 式）；StatusBar 极简化（左状态点 + 右主题切换）
- 现有 data-testid 全部保留（layout/filetree 测试不破）
- 验证：`bun run test` 绿；tauri:dev 肉眼
- Commit: `feat(ui): floating-panel shell layout`

## Task 3：ChatArea 重构（Claude/OpenAI 对话风）
- 居中 max-w-3xl 列;assistant 消息**去气泡**（正文直接排在背景上,Claude 式）,user 消息右侧
  浅色圆角胶囊;输入区改悬浮圆角卡（textarea+发送钮同框,`rounded-2xl border bg-background/85
  backdrop-blur`);sources chips/工具活动行沿用但配色跟新 token;空态 ShinyText 保留
- 注意:`message-{role}-{i}`、`tool-part-*`、send-button 等 testid 不动;chat 测试断言
  justify-end/start 的两条可能要跟布局调整（允许改断言,行为语义不变）
- 验证：`bun run test` 绿；tauri:dev 真对话肉眼（含 agentic 工具行）
- Commit: `feat(ui): chat redesign — Claude-style message column`

## Task 4：Settings + Onboarding 重构
- Settings：分区卡片化（每个 section 一张 `rounded-xl border bg-background/75` 卡），控件
  统一（toggle 沿用现款式即可，select/input 圆角对齐 --radius）
- Onboarding：hero 区 serif 标题 + DotGrid 透出（页面本身已全屏，主要是配色/间距/卡片化）
- 验证：settings/onboarding 测试绿（testid 保留）；肉眼
- Commit: `feat(ui): settings & onboarding restyle`

## Task 5：FileTree / Editor / Overview / Review / Community polish
- 统一 hover/selected 态（accent token）、间距、圆角;MarkdownEditor 工具条对齐新风格
- 验证：全 vitest 绿；肉眼
- Commit: `feat(ui): knowledge/review/community polish pass`

## Task 6：收尾
- `bun run test` + `cd server && bun test` + tsc 双侧 + `bun run tauri:build` 过一遍
- HANDOFF 加 Phase UI 条目;learnings 若有 WKWebView/canvas 性能发现则记录
- Commit: `docs: UI redesign wrap-up`

## Verification 总则
每 task：vitest 全绿 + tsc clean;视觉验收（用户 tauri:dev）安排在 Task 2、3、6 后的
checkpoint。canvas/gsap 在 happy-dom 无法真渲染——组件内 guard + 测试只断言挂载不炸。
