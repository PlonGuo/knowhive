# 技术验证记录:bun 单二进制 × 原生 ML 依赖(Phase F spike)

> 2026-07-06/07。Phase F 打包前的硬闸 spike:`bun build --compile` 能否把带 onnxruntime-node(Phase E2 的原生 ONNX runtime)的 sidecar 编译成单二进制。**结论:可行(全链路验通),但基于工程 trade-off 选择了不使用**——这个决策本身是本文最重要的部分(§4)。

## 1. 背景

sidecar 依赖链里有两个原生模块:`onnxruntime-node`(cross-encoder 推理,260KB `.node` 胶水 + 34MB `libonnxruntime.dylib` 推理引擎)和 `sharp`(transformers.js 的图像依赖,纯文本管道用不到但被顶层 import)。分发要求用户机器不装 bun——要么单二进制(D),要么随 app 附带 bun runtime(C)。

## 2. Spike 过程:四层坑及机制

| # | 报错 | 机制 | 修法 |
|---|---|---|---|
| 1 | `dlopen: Library not loaded: @rpath/libonnxruntime.dylib` | compile 嵌入了 `.node` 并在运行时解压到 /tmp 随机目录,但它动态链接的 dylib 没跟着走,@rpath 搜索落空 | 附带 dylib + spawn 时注入 `DYLD_LIBRARY_PATH`(dyld 按 leaf name 优先搜该目录) |
| 2 | `Could not load the "sharp" module` | sharp 的平台包是运行时拼字符串 require(`@img/sharp-${platform}-${arch}`),**bundler 静态分析看不见动态 require**,没打进 bundle | 纯文本管道用不到 sharp → Bun.build plugin 把它 resolve 到 stub 模块 |
| 3 | `Cannot find package 'onnxruntime-node' from '/$bunfs/root/...'` | **`--external` + `--compile` 互斥**:external 包在运行时从只读虚拟文件系统 bunfs 解析,那里没有也不可能有 node_modules | 两步构建:先 Bun.build(external 保留裸引用)出 bundle.js,再 CLI compile(此时静态解析并嵌入 .node) |
| 4 | `EROFS`(写模型缓存) | transformers.js 默认缓存路径是相对路径,在编译环境里解析进只读 bunfs | 显式 `env.cacheDir` → app data dir(**C 方案同样需要**:.app 内资源目录只读) |

最终形态验证通过:64MB 单二进制 + 34MB dylib 附件,`/health` + cross-encoder 加载全通。

## 3. 顺带确认的 bun 事实

- `bun add @huggingface/transformers` 会被拦 postinstall,需 `bun pm trust onnxruntime-node protobufjs`(onnxruntime 的 postinstall 负责取原生绑定)
- 静态 require 的 `.node` 会被 compile 嵌入并在运行时解压加载;其 dylib 依赖不会
- compile 产物内部代码住在 `/$bunfs/root/`(只读),所有相对路径/向上查找类逻辑都会撞墙

## 4. 决策:验证可行,选择不用(发布走 C)

**C 方案** = 不 compile:`bun build --target=bun` 出 bundle.js,随 app 附带 bun runtime(externalBin)+ 原生依赖的真实 node_modules 片段,Rust spawn `bun index.js`。

对比(在 Tauri .app 里,用户体验两者完全相同):

| | D(单二进制) | C(附带 runtime) |
|---|---|---|
| 分发增量 | ~98MB | ~155MB(差距在 Ollama 语境下无感) |
| 运行时机关 | DYLD 注入 + sharp stub + 两步构建 | **零**(原生模块按设计意图从磁盘加载) |
| 新增原生依赖 | 每个都要重判断/重踩(动态 require?dylib 独立?) | 复制清单加一行 |
| bun 升级 | compile/bunfs 行为在活跃演化,需重验 | `bun run` 是最稳核心路径 |
| 公证 | hardened runtime 默认忽略 DYLD_* → 需 entitlement | 常规(挨个签二进制) |
| 行业同构 | 少见组合 | **= Electron/VS Code 的分发结构** |

**判定逻辑**:D 的工程优势(单文件、少 60MB、CI 测试即分发物)在 Tauri bundle 内对用户不可见;它的成本是**持续的**(维护期不确定性)。「能做炫的方案但按 trade-off 选无聊的方案」比「ship 了炫的方案并一直养着它」展示的判断力更强——本项目的所有选型(暴力 KNN、保留 Ollama、Tauri 加权打分)都是同一个模式。

**回切 D 的触发条件**(逃生舱是双向的):出现真实的体积硬约束;或 bun 未来原生支持 dylib 伴随嵌入(届时机关消失,D 变纯赢)。切换成本约一天(两方案共享 90% 工程:Rust spawn 改造、cacheDir、打包验证清单)。

## 5. 面试要点速查

- **"为什么不编译成单二进制?"** → 不是不能,是不值:spike 全链路验通了(四层坑各有机制解释),但单文件的优势在 .app 里不可见,维护成本却是持续的;附带 runtime 是 Electron/VSCode 验证过的形状。文档里留了回切条件。
- **"动态 require 为什么打不进 bundle?"** → bundler 靠静态分析 import/require 的字符串字面量爬依赖树,运行时拼接的字符串不可见——这是所有 bundler 的共同边界,不是 bun 的缺陷。
- **"dylib 为什么会丢?"** → 加载器只保证加载你显式 require 的 .node;.node 头部声明的 @rpath 依赖是 dyld 在原目录布局下才能解析的,换了解压位置就断。
