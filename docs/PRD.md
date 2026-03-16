# KnowHive — 产品需求文档 (PRD)

**版本**: v1.0
**日期**: 2026-03-09
**仓库**: `github.com/PlonGuo/knowhive`

---

## 1. 产品概述与愿景

### 1.1 产品定义

KnowHive 是一款**本地优先 (local-first)** 的通用 AI 知识库桌面工具。用户可以将 Markdown 文件导入本地知识库，通过 RAG 技术与 AI 自然语言对话，实现知识的高效检索与学习。

### 1.2 核心理念

- **隐私优先 / 离线可用**: 所有数据存储在本地，使用本地 LLM 时无需网络连接
- **通用知识库**: LeetCode 题解作为开发阶段测试内容，设计为通用工具
- **开源透明**: MIT License，社区驱动
- **LLM 灵活配置**: 支持本地 (Ollama) 与云端 (OpenAI Compatible)

### 1.3 产品愿景

成为开发者和学习者的首选本地 AI 知识管理工具——像和一个熟读你所有笔记的专家对话一样简单。

---

## 2. 用户画像

| 画像 | 背景 | 痛点 | 核心需求 |
|------|------|------|----------|
| 刷题求职者 | 积累大量 LeetCode 笔记 | 笔记分散，复习找不到 | 快速检索 + AI 总结 |
| 技术文档管理者 | 维护大量技术笔记 | 全文搜索不够智能 | 语义搜索 + 上下文关联 |
| 隐私敏感学习者 | 笔记含敏感内容 | 不信任云端 AI | 本地 LLM 全离线可用 |

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App (主进程)                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │              React + TypeScript (渲染进程)          │  │
│  │  ┌──────────┐ ┌──────────────┐ ┌──────────────┐  │  │
│  │  │ Sidebar  │ │  Chat Window │ │  Settings    │  │  │
│  │  │ FileTree │ │  (主对话区)   │ │  Page        │  │  │
│  │  └──────────┘ └──────────────┘ └──────────────┘  │  │
│  │        shadcn/ui + Tailwind CSS                    │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │ HTTP / SSE                     │
│  ┌──────────────────────▼────────────────────────────┐  │
│  │           FastAPI Sidecar (Python 子进程)           │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────────────┐ │  │
│  │  │ Ingest  │ │  Query   │ │  Config / Health   │ │  │
│  │  │ Service │ │  Service │ │  Service           │ │  │
│  │  └────┬────┘ └────┬─────┘ └────────────────────┘ │  │
│  │       │           │                                │  │
│  │  ┌────▼───────────▼─────┐                         │  │
│  │  │      LangChain       │                         │  │
│  │  │  ├─ DocumentLoader   │                         │  │
│  │  │  ├─ TextSplitter     │                         │  │
│  │  │  ├─ Embeddings       │                         │  │
│  │  │  └─ ChatModel        │                         │  │
│  │  └──────────┬───────────┘                         │  │
│  │             │                                      │  │
│  │  ┌──────────▼───────────┐  ┌──────────────────┐  │  │
│  │  │   Chroma (向量DB)    │  │  SQLite (元数据)  │  │  │
│  │  └──────────────────────┘  └──────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                         │                                │
│              ┌──────────▼──────────┐                    │
│              │  Ollama / OpenAI    │                    │
│              │  Compatible API     │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

### 数据存储

```
~/Library/Application Support/knowhive/  (macOS)
%APPDATA%/knowhive/                      (Windows)
  ├── chroma/          # Chroma 向量数据库
  ├── knowhive.db      # SQLite 数据库
  ├── config.yaml      # 用户配置
  ├── knowledge/       # 用户知识库文件 (source of truth)
  └── exports/         # 导出文件
```

### 进程通信

- HTTP REST API (非 streaming) + SSE (streaming 回答)
- FastAPI 监听 `127.0.0.1:动态端口`
- 启动: Electron → spawn FastAPI → health check 轮询 → ready 后渲染 UI
- 关闭: Electron → shutdown 信号 → 等待优雅退出 → 超时强制 kill

---

## 4. 开发阶段与功能规格

### Phase 1: POC — 打包验证

| 功能项 | 验收标准 |
|--------|----------|
| Electron 基础壳 | 双击 .app 可见窗口 |
| FastAPI sidecar 启动 | health check 返回 200 |
| 前后端通信 | 页面显示 FastAPI 返回内容 |
| 动态端口 | 多实例不冲突 |

技术要点: 要求用户系统安装 Python 3.11+ 和 uv，Electron 通过 sidecar 启动 FastAPI

### Phase 2: 核心 RAG (MVP)

#### 2.1 文件导入 (Ingest)

| 功能项 | 描述 |
|--------|------|
| 导入方式 | UI 选择文件/文件夹 |
| 支持格式 | Markdown (.md) only |
| 文件存储 | 复制到 `knowledge/` 目录，保持目录结构 |
| 文本分割 | `RecursiveCharacterTextSplitter`，chunk_size=1000, overlap=200 |
| Embedding | 根据用户语言设置选择模型 |
| 向量存储 | 存入 Chroma，metadata 含 file_path, chunk_index |
| 去重 | 同路径文件先删旧向量再重新 embed |
| 进度反馈 | 返回已处理/总文件数 |

Embedding 模型选择:
- English → `all-MiniLM-L6-v2` (~80MB)
- 中文 → `text2vec-chinese` (~400MB)
- 中英混合 → `BGE-m3` (~1.2GB)

#### 2.2 对话查询 (Query)

| 功能项 | 描述 |
|--------|------|
| 检索 | Chroma top-k (默认 k=5) |
| Prompt | 系统 prompt + 检索上下文 + 用户问题 |
| 回答 | LLM streaming，SSE 推送 |
| 来源引用 | 回答附带源文件路径列表 |
| 无上下文 | 告知用户知识库中无相关内容 |

#### 2.3 UI — 主界面

```
┌──────────────┬──────────────────────────────────────────┐
│  [+ Import]  │   AI 回答 (Markdown rendered)            │
│              │   **Sources**: file1.md, ...              │
│  📁 knowledge│                                          │
│  ├── 📁 leet │   ┌─────────────────────────────┐       │
│  │  ├── 📄 ..│   │ 用户消息                     │       │
│  │  └── 📄 ..│   └─────────────────────────────┘       │
│  └── 📁 notes│                                          │
│              ├──────────────────────────────────────────┤
│  ⚙️ Settings │  [Type your message...        ] [Send]  │
├──────────────┴──────────────────────────────────────────┤
│  Status: Ready | Knowledge: 42 files | LLM: Ollama     │
└─────────────────────────────────────────────────────────┘
```

- 左侧: VSCode 风格文件树，可折叠，点击文件打开只读预览
- 中央: ChatGPT 风格对话，Markdown 渲染 (加粗、高亮、代码块)
- 底部: 状态栏
- 交互: Enter 发送，Shift+Enter 换行，streaming 逐 token 渲染

#### 2.4 Settings 页面

| 配置项 | 说明 |
|--------|------|
| LLM Provider | `ollama` / `openai-compatible` |
| Model Name | 如 `llama3`, `gpt-4o` |
| Base URL | 如 `http://localhost:11434` |
| API Key | 仅 openai-compatible 时显示 |
| Embedding Language | English / 中文 / Mixed，显示模型下载大小 |
| 连接测试按钮 | 验证 LLM 可用性 |

#### 2.5 启动同步

启动时扫描 `knowledge/` 目录，与 SQLite 对比:
- 新文件 → embed + 插入 DB
- 修改文件 (mtime/hash 变化) → 重新 embed
- 删除文件 → 删除向量 + DB 记录

#### 2.6 对话历史

- 所有消息存 SQLite，单一会话窗口
- 启动时加载历史到聊天界面
- 提供"清空对话历史"按钮

### Phase 3: 完整功能

- 动态 Ingest (file watcher 实时更新向量库)
- PDF 支持 (PyMuPDF/pdfplumber)
- LLM 动态切换 (无需重启)
- 文件编辑 (内置 Markdown 编辑器)
- 文件管理 (删除、重命名)
- Anthropic Claude Provider
- RAGAs 评估 + Langfuse Tracing

### Phase 4: 体验优化

- Embedding 模型下载进度条
- 社区内容浏览与一键导入 (`knowhive-community` repo)
- 数据导出
- 间隔重复复习提醒
- AI 复习总结

### Phase 5: 发布

- macOS (.dmg) + Windows (.exe) 打包
- 首次启动引导流程
- 文档 + 贡献指南
- Telegram / Discord bot 集成
- `knowhive-community` 社区 repo 开源

---

## 5. API 设计 (FastAPI)

### Health & Config

```
GET  /health                → { "status": "ok", "version": "0.1.0" }
GET  /config                → 当前配置
PUT  /config                → 更新配置
POST /config/test-llm       → 测试 LLM 连接
```

### Ingest

```
POST /ingest/files          → 上传文件导入，返回 { task_id, total_files }
POST /ingest/directory      → 导入本地目录
GET  /ingest/status/{id}    → 查询导入进度
POST /ingest/resync         → 手动触发同步
```

### Chat

```
POST /chat                  → SSE stream (token events + sources event + done event)
     Body: { "message": "...", "top_k": 5 }
GET  /chat/history          → 获取对话历史 (?limit=50&offset=0)
DELETE /chat/history        → 清空对话历史
```

### Knowledge

```
GET  /knowledge/tree        → 文件树结构
GET  /knowledge/file?path=  → 文件内容 (只读)
DELETE /knowledge/file      → 删除文件 + 对应向量
```

### Embedding

```
GET  /embedding/models      → 可用模型列表 (含大小、下载状态)
POST /embedding/download    → 下载模型 (SSE 进度)
GET  /embedding/status      → 当前模型状态
```

---

## 6. 数据库 Schema (SQLite)

```sql
-- 知识库文件元数据
CREATE TABLE documents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path       TEXT NOT NULL UNIQUE,
    file_name       TEXT NOT NULL,
    file_size       INTEGER,
    file_hash       TEXT,                       -- SHA256
    modified_at     TEXT NOT NULL,
    indexed_at      TEXT,
    chunk_count     INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'pending',     -- pending / indexed / error
    error_message   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- 对话消息
CREATE TABLE chat_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    role            TEXT NOT NULL,              -- user / assistant
    content         TEXT NOT NULL,
    sources         TEXT,                       -- JSON array
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Ingest 任务
CREATE TABLE ingest_tasks (
    id              TEXT PRIMARY KEY,           -- UUID
    status          TEXT DEFAULT 'pending',
    total_files     INTEGER DEFAULT 0,
    processed_files INTEGER DEFAULT 0,
    errors          TEXT,                       -- JSON array
    created_at      TEXT DEFAULT (datetime('now')),
    completed_at    TEXT
);

-- 注: 配置存储于 config.yaml (唯一配置源)，不使用 SQLite 存配置
```

Chroma Collection: `knowhive_docs`，Document ID: `{file_path}::chunk_{index}`

---

## 7. 项目目录结构

```
knowhive/
├── electron/                    # Electron 主进程
│   ├── main.ts
│   ├── preload.ts
│   └── sidecar.ts               # FastAPI 子进程管理
├── src/                         # React 前端
│   ├── components/
│   │   ├── ui/                  # shadcn/ui
│   │   ├── chat/                # ChatPage, MessageList, MessageBubble, ChatInput, SourcesList
│   │   ├── sidebar/             # Sidebar, FileTree, ImportButton
│   │   ├── settings/            # SettingsPage
│   │   ├── preview/             # FilePreview
│   │   └── layout/              # Layout, StatusBar
│   ├── hooks/                   # useChat, useFileTree, useSettings
│   ├── lib/                     # api.ts, sse.ts
│   ├── App.tsx
│   └── main.tsx
├── backend/                     # FastAPI 后端
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models.py
│   │   ├── routers/             # health, chat, ingest, knowledge, config_router, embedding
│   │   └── services/            # rag_service, ingest_service, chat_service, sync_service
│   ├── pyproject.toml
│   └── uv.lock
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tailwind.config.ts
├── electron-builder.yml
└── LICENSE
```

---

## 8. 非功能需求

| 类别 | 要求 |
|------|------|
| 启动时间 | < 10 秒 (UI 可用) |
| 单文件 Ingest | < 2 秒 |
| 查询首 token | < 3 秒 (取决于 LLM) |
| 内存占用 (空闲) | < 500MB |
| 安全 | FastAPI 仅监听 127.0.0.1，Electron 启用 contextIsolation |
| 兼容性 | macOS 12+, Windows 10+, Electron 28+, Python 3.11+ |
| 可靠性 | Markdown 为 source of truth，SQLite/Chroma 可重建；FastAPI 崩溃自动重启 (最多 3 次) |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Electron + Python 打包失败 | Phase 1 最先验证 |
| Embedding 模型下载慢 | 显示下载大小和进度，后续加国内镜像 |
| Chroma 大量文件性能 | 合理 chunk 策略，监控性能 |
| LLM 不可用 | 清晰错误提示，引导检查配置 |

---

## 10. 验证方式

### Phase 1 验证
- 在无 Python 环境的 macOS 机器上运行打包后的 .app
- 确认 Electron 窗口显示 FastAPI 返回内容

### Phase 2 (MVP) 验证
- 手动准备 10+ LeetCode Markdown 文件导入
- 针对导入内容提问 10 个测试问题，验证 8+ 个引用正确源文件
- 连续使用 1 小时无崩溃
- 验证 Ollama 和 OpenAI Compatible 两种 LLM 模式

### 后续阶段
- 加入 RAGAs 自动化评估检索质量
- 集成测试覆盖核心 API 端点
