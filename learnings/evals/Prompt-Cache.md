# Prompt Cache：把 volatile 检索内容挪出稳定前缀 — Tier 1-3

**日期**: 2026-07-17 · **provider**: DeepSeek（`deepseek-chat`，openai-compatible）
**结论**: **系统提示里塞每轮变化的检索内容 = 缓存杀手。把 context 挪进 user 消息尾部后,
多轮会话缓存命中从 0% → 22%(且随对话变长而涨)**

## 病灶

DeepSeek 自动做 prefix caching(服务端按请求前缀缓存,命中 token 计价约 miss 的 1/10)。
命中的前提是**请求前缀逐字节相同**。原本 `buildSystemPrompt` 把检索到的 chunks 直接拼进
**system message**(第一条消息):

```
system = SYSTEM_PROMPT + custom + INJECTION_GUARD + <retrieved_context>  ← 每轮都变
messages = [turn1_user, turn1_asst, ..., turnN_user]
```

system 是位置 0。它每轮都变(context 不同)→ **前缀在 context 处立刻断裂 → 它后面的整段
对话历史永远缓存不到**。summary/recalled memories 同理(volatile 却塞在 system)。

## 修法(Tier 1-3)

system 只留**稳定内容**,volatile 的东西挪到**当前 user 消息尾部**:

- `buildSystemPrompt(custom)` / `buildAgentSystemPrompt(custom)` — 去掉 chunks 参数,只剩
  SYSTEM_PROMPT + custom + INJECTION_GUARD [+ tool guidance]。跨轮逐字节稳定。
- `buildContextBlock(chunks)`(rag.ts,纯)— 产出 `<retrieved_context>` fenced 块。
- `buildUserPreface({summary, memories, context})`(memory.ts,纯)— 把 volatile 三件套拼成
  preface。
- `chatRoutes` — preface 前置到最后一条 user 消息;procedural instructions 留 system(稳定)。

```
system = SYSTEM_PROMPT + custom + INJECTION_GUARD [+ instructions]  ← 逐轮不变
messages = [turn1_user(clean), turn1_asst, ..., turnN_user(preface + question)]
```

历史存的是**干净** Q/A(afterExchange 存原始问题,不含 context),所以
`[system][turn1..N-1]` 成为跨请求的稳定前缀 → DeepSeek 缓存它,只有尾部新 context+问题 miss。

## 量化(6 轮真实尺寸会话,同对话两种 shape 对打)

system ~250 tok、每轮 context ~300 tok、assistant 答复 ~150 tok(逼近真实 KnowHive 聊天)。

| turn | OLD cacheRead | NEW cacheRead |
|---|---|---|
| 1 | 0 (0%) | 0 (0%) |
| 2 | 0 (0%) | 0 (0%) |
| 3 | 0 (0%) | 0 (0%) |
| 4 | 0 (0%) | 256 (**26%**) |
| 5 | 0 (0%) | 384 (**35%**) |
| 6 | 0 (0%) | 512 (**39%**) |
| **session** | **0 / 5252 (0%)** | **1152 / 5240 (22%)** |

- **OLD 全程 0%**:system 每轮变,连那 ~250 tok 静态头都因为后面紧跟 volatile context 而没能
  形成有效可缓存前缀。整个会话 5252 input token 全额计费。
- **NEW 第 4 轮起命中**:累积历史越过 DeepSeek 的缓存下限后开始命中,且**逐轮爬升**
  (26→35→39%)。命中率随对话长度单调增——越长的会话省得越多。
- 成本:命中 token 约 miss 的 1/10,22% 命中 ≈ 该 6 轮会话 input 成本降约 20%,长会话更多;
  命中还降 TTFT。

## 诚实边界

- **单跳/短会话几乎没收益**:缓存要等历史累积过下限(本例第 4 轮),前 3 轮 0%。RAGAS 那种
  独立单问评估集享受不到多轮缓存,只能吃到稳定 system 头(两种 shape 都能吃)。
- 这不是"引入某个 SDK",而是**请求结构性质**:DeepSeek 服务端自动缓存,我要做的只是别把
  volatile 内容放进稳定前缀。Anthropic 则需要显式 `cache_control` 断点(本项目 chat 主走
  DeepSeek/Ollama,没上)。
## 安全回归(重点:优化差点破坏防御)

把 context 从 system 挪到 user role,**注入防御明显退化了**——重跑 single 红队:

| 攻击 | 缓解 old-shape(context 在 system) | naive new(context 裸进 user) | +inline guard |
|---|---|---|---|
| direct-command | 1/3 | 2/3 | 2/3 |
| role-hijack | 2/3 | 2/3 | **1/3** |
| memory-poison | 1/3 | **3/3** | **1/3** |
| **mean** | **0.266** | **0.468** | **0.266** |

- naive new shape 沦陷率 **0.27→0.47**,比原始无防御基线(0.40)还差。根因:**user role 的
  文本被模型当成"用户自己说的话",权威性更高**——埋在里面的"记住我喜欢 X""你现在是…"
  更容易被执行(memory-poison 直接 1/3→3/3 全破)。system role 的 fence 本身在压制权威性。
- 修法:context 块自带一段 **inline untrusted-data guard**(紧贴数据,不只靠 system guard)+
  用 `My question (answer only this):` 显式分隔真实问题。复测 **0.468→0.266**,和 old-shape
  完全打平。role-hijack 甚至更好(2/3→1/3)。
- **结论:缓存优化零安全代价成立,但前提是补了 inline guard**。system guard 对 user-role
  数据不够,防御要跟着数据的位置走。详见 `Prompt-Injection-Redteam.md`。

## 面试点

「我发现自己的 RAG 在多轮对话里几乎吃不到 DeepSeek 的 prefix cache——因为我把每轮变化的
检索内容拼进了 system prompt,而 system 是第一条消息,它一变,后面整段历史的缓存前缀就断了。
我把 system 收敛成稳定指令,把 context 挪到当前 user 消息尾部,历史存干净 Q/A,于是
`system+历史` 变成跨请求的稳定前缀。6 轮会话缓存命中从 0% 涨到 22%,而且随对话变长继续涨,
input 成本降两成、TTFT 也降。

但最能说明问题的是我踩的坑:这个优化差点破坏安全。context 从 system 挪到 user role 后,我
自己的注入红队立刻抓到沦陷率从 0.27 飙到 0.47——比没做任何防御还差。因为 user role 的内容
模型当成用户亲口说的,权威更高,埋进去的『记住我喜欢 X』直接全破。我给 context 块补了紧贴
数据的 inline untrusted guard 加显式问题分隔,复测打回 0.27,和原来打平,缓存收益一分没丢。
这件事我想讲的是:性能优化不能只看性能指标,我有红队当护栏,才在提交前抓到了这个 tradeoff。
缓存优化不玄学——别让 volatile 数据污染稳定前缀;但安全防御要跟着数据的位置走,不能假设
system 里的一句 guard 到哪都管用。」
