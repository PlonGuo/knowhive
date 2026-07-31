import { useEffect, useRef, useState } from 'react'
import { fetchOllamaStatus, pullModel, type OllamaStatus } from '../../lib/ollama'
import { saveFile } from '../../lib/platform'

// Settings deliberately exposes only decisions a USER can actually make (which
// model to talk to, security boundaries, personalization). Retrieval knobs that
// have a measured best answer — pre-retrieval strategy, reranker on/off, memory
// window size, parent expansion — are auto-routed in code; their config fields
// still exist for config.yaml power users and pass through Save untouched.
interface AppConfig {
  llm_provider: 'ollama' | 'openai-compatible' | 'anthropic'
  model_name: string
  base_url: string
  api_key: string | null
  embedding_language: 'english' | 'chinese' | 'mixed'
  pre_retrieval_strategy: 'none' | 'hyde' | 'multi_query' | 'auto' | 'auto_llm'
  use_reranker: boolean
  chat_mode: 'single' | 'agentic'
  chat_permission_mode: 'ask' | 'accept-edits' | 'readonly'
  chat_memory_turns: number
  custom_system_prompt: string
}

interface TestResult {
  success: boolean
  message?: string
  error?: string
}

interface SettingsPageProps {
  backendUrl: string
  onBack?: () => void
  onConfigSaved?: () => void
}

interface RerankerStatus {
  available?: boolean
  model: string
  size_mb: number
  downloaded: boolean
  loaded: boolean
}

interface RerankerDownloadStatus {
  status: string | null
  progress?: number
  error?: string
}

interface MemoryItem {
  id: number
  kind: 'semantic' | 'procedural'
  content: string
  created_at: string
}

interface EmbeddingPull {
  model: string
  percent: number
  status: string
  error?: string
}

const defaultConfig: AppConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
  pre_retrieval_strategy: 'none',
  use_reranker: false,
  chat_mode: 'single',
  chat_permission_mode: 'ask',
  chat_memory_turns: 0,
  custom_system_prompt: '',
}

export default function SettingsPage({ backendUrl, onBack, onConfigSaved }: SettingsPageProps) {
  const [config, setConfig] = useState<AppConfig>(defaultConfig)
  const configRef = useRef(config)
  configRef.current = config
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [ollama, setOllama] = useState<OllamaStatus | null>(null)
  const [embeddingPull, setEmbeddingPull] = useState<EmbeddingPull | null>(null)
  const [showEmbeddingWarning, setShowEmbeddingWarning] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [rerankerStatus, setRerankerStatus] = useState<RerankerStatus | null>(null)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [editingMemory, setEditingMemory] = useState<{ id: number; content: string } | null>(null)
  const [rerankerDownloading, setRerankerDownloading] = useState(false)
  const [rerankerDownloadStatus, setRerankerDownloadStatus] = useState<RerankerDownloadStatus | null>(null)
  const rerankerPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch(`${backendUrl}/config`)
      .then((r) => r.json())
      .then((data: AppConfig) => setConfig(data))
      .catch(() => {})
  }, [backendUrl])

  useEffect(() => {
    fetchOllamaStatus(backendUrl)
      .then(setOllama)
      .catch(() => setOllama(null))
  }, [backendUrl])

  useEffect(() => {
    fetch(`${backendUrl}/reranker/status`)
      .then((r) => (r.ok ? r.json() : Promise.resolve(null)))
      .then((data: RerankerStatus | null) => {
        if (data) setRerankerStatus(data)
      })
      .catch(() => {})
  }, [backendUrl])

  useEffect(() => {
    fetch(`${backendUrl}/memories`)
      .then((r) => (r.ok ? r.json() : { memories: [] }))
      .then((data: { memories: MemoryItem[] }) => setMemories(data.memories ?? []))
      .catch(() => {})
  }, [backendUrl])

  const deleteMemory = async (id: number) => {
    await fetch(`${backendUrl}/memories/${id}`, { method: 'DELETE' }).catch(() => {})
    setMemories((prev) => prev.filter((m) => m.id !== id))
  }

  const saveMemoryEdit = async () => {
    if (!editingMemory) return
    const { id, content } = editingMemory
    if (content.trim()) {
      await fetch(`${backendUrl}/memories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }).catch(() => {})
      setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)))
    }
    setEditingMemory(null)
  }

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (rerankerPollRef.current) clearInterval(rerankerPollRef.current)
    }
  }, [])

  // /ollama/status derives the required embedding model from the *saved* config, so
  // the indicator reflects the saved language; a changed dropdown applies on Save.
  const embeddingModel = ollama?.required?.find((r) => r.purpose === 'embedding') ?? null

  const handleDownloadEmbedding = async () => {
    if (!embeddingModel) return
    const model = embeddingModel.name
    setEmbeddingPull({ model, percent: 0, status: 'starting' })
    const result = await pullModel(backendUrl, model, (percent, status) =>
      setEmbeddingPull({ model, percent, status }),
    )
    if (!result.ok) {
      setEmbeddingPull({ model, percent: 0, status: 'error', error: result.error })
      return
    }
    setEmbeddingPull(null)
    fetchOllamaStatus(backendUrl).then(setOllama).catch(() => {})
  }

  // Downloaded == enabled: once the model is on disk there is no reason to leave
  // better ranking off, so completion flips use_reranker on and persists it.
  const enableRerankerAfterDownload = async () => {
    const next = { ...configRef.current, use_reranker: true }
    setConfig(next)
    await fetch(`${backendUrl}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {})
  }

  const checkRerankerDownload = async (): Promise<boolean> => {
    // Returns true when polling should stop.
    try {
      const res = await fetch(`${backendUrl}/reranker/download-status`)
      const data: RerankerDownloadStatus = await res.json()
      setRerankerDownloadStatus(data)
      if (data.status === 'complete' || data.status === 'error') {
        setRerankerDownloading(false)
        const statusRes = await fetch(`${backendUrl}/reranker/status`)
        const status: RerankerStatus = await statusRes.json()
        setRerankerStatus(status)
        if (data.status === 'complete') await enableRerankerAfterDownload()
        return true
      }
      return false
    } catch {
      setRerankerDownloading(false)
      return true
    }
  }

  const startRerankerPolling = async () => {
    if (rerankerPollRef.current) clearInterval(rerankerPollRef.current)
    // Immediate check first (fast completions and tests), then poll.
    if (await checkRerankerDownload()) return
    rerankerPollRef.current = setInterval(async () => {
      if (await checkRerankerDownload()) {
        if (rerankerPollRef.current) clearInterval(rerankerPollRef.current)
        rerankerPollRef.current = null
      }
    }, 1000)
  }

  const handleRerankerDownload = async () => {
    setRerankerDownloading(true)
    setRerankerDownloadStatus({ status: 'downloading', progress: 0 })
    try {
      await fetch(`${backendUrl}/reranker/download`, { method: 'POST' })
      await startRerankerPolling()
    } catch {
      setRerankerDownloading(false)
    }
  }

  const handleSave = async () => {
    setSaveMessage(null)
    setTestResult(null)
    setShowEmbeddingWarning(false)

    try {
      await fetch(`${backendUrl}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      setSaveMessage('Settings saved')
      onConfigSaved?.()
      // Refresh model readiness against the newly saved config; warn if the
      // embedding model for the selected language isn't installed.
      try {
        const status = await fetchOllamaStatus(backendUrl)
        setOllama(status)
        const embedding = status.required?.find((r) => r.purpose === 'embedding')
        if (embedding && !embedding.installed) setShowEmbeddingWarning(true)
      } catch {
        // status refresh is best-effort
      }
    } catch {
      setSaveMessage('Failed to save settings')
    }
  }

  const handleExportAll = async () => {
    setExportStatus(null)
    setExporting(true)
    try {
      const res = await fetch(`${backendUrl}/export/full`, { method: 'POST' })
      const blob = await res.blob()
      const defaultName = `knowhive-export-${new Date().toISOString().slice(0, 10)}.zip`
      const savePath = await saveFile(defaultName)
      if (savePath) {
        // In Electron, trigger download via anchor
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = defaultName
        a.click()
        URL.revokeObjectURL(url)
        setExportStatus('Export saved')
      } else {
        setExportStatus('Export cancelled')
      }
    } catch {
      setExportStatus('Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleExportChat = async () => {
    setExportStatus(null)
    setExporting(true)
    try {
      const res = await fetch(`${backendUrl}/export/chat`, { method: 'POST' })
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const defaultName = `knowhive-chat-${new Date().toISOString().slice(0, 10)}.json`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = defaultName
      a.click()
      URL.revokeObjectURL(url)
      setExportStatus('Chat history exported')
    } catch {
      setExportStatus('Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleTestConnection = async () => {
    setTestResult(null)
    setTesting(true)
    try {
      await fetch(`${backendUrl}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const res = await fetch(`${backendUrl}/config/test-llm`, { method: 'POST' })
      const data: TestResult = await res.json()
      setTestResult(data)
    } catch {
      setTestResult({ success: false, error: 'Request failed' })
    } finally {
      setTesting(false)
    }
  }

  // Chat-composer vocabulary: soft frames on the translucent background.
  const inputClass =
    'w-full rounded-xl border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring'
  const labelClass = 'block text-sm font-medium text-foreground mb-1'
  const selectClass = inputClass
  const cardClass =
    'rounded-2xl border bg-background/85 p-5 shadow-sm backdrop-blur-md space-y-4'
  const sectionTitleClass = 'font-serif text-lg font-semibold text-foreground'

  const isPullingEmbedding = embeddingPull !== null && !embeddingPull.error

  return (
    <div data-testid="settings-page" className="flex-1 overflow-y-auto bg-transparent px-6 py-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            data-testid="settings-back-button"
            onClick={onBack}
            className="rounded-xl border bg-background/70 px-2.5 py-1 text-sm text-muted-foreground backdrop-blur-sm hover:bg-accent hover:text-accent-foreground"
          >
            &larr; Back
          </button>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Settings</h1>
        </div>

        <div className="space-y-4">
          {/* Model: which LLM to talk to. */}
          <div className={cardClass}>
            <h3 className={sectionTitleClass}>Model</h3>
            <div>
              <label className={labelClass}>LLM Provider</label>
              <select
                data-testid="llm-provider-select"
                value={config.llm_provider}
                onChange={(e) =>
                  setConfig({ ...config, llm_provider: e.target.value as AppConfig['llm_provider'] })
                }
                className={selectClass}
              >
                <option value="ollama">Ollama</option>
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Model Name</label>
              <input
                data-testid="model-name-input"
                type="text"
                value={config.model_name}
                onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Base URL</label>
              <input
                data-testid="base-url-input"
                type="text"
                value={config.base_url}
                onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                className={inputClass}
              />
            </div>

            {(config.llm_provider === 'openai-compatible' || config.llm_provider === 'anthropic') && (
              <div>
                <label className={labelClass}>API Key</label>
                <input
                  data-testid="api-key-input"
                  type="password"
                  value={config.api_key ?? ''}
                  onChange={(e) => setConfig({ ...config, api_key: e.target.value || null })}
                  className={inputClass}
                  placeholder="sk-..."
                />
              </div>
            )}
          </div>

          {/* Retrieval: language drives the embedding model; the ranking model is a
              one-time download that enables itself. Everything else routes in code. */}
          <div className={cardClass}>
            <h3 className={sectionTitleClass}>Retrieval</h3>
            <div>
              <label className={labelClass}>Embedding Language</label>
              <select
                data-testid="embedding-language-select"
                value={config.embedding_language}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    embedding_language: e.target.value as AppConfig['embedding_language'],
                  })
                }
                className={selectClass}
              >
                <option value="english">English</option>
                <option value="chinese">Chinese</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>

            {embeddingModel && (
              <div
                data-testid="embedding-model-section"
                className="rounded-xl border bg-muted/40 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {embeddingModel.name} <span className="text-xs">(via Ollama)</span>
                  </span>
                  {embeddingModel.installed ? (
                    <span
                      data-testid="embedding-ready-indicator"
                      className="text-xs font-medium text-green-600"
                    >
                      ✓ Ready
                    </span>
                  ) : (
                    <button
                      data-testid="download-embedding-button"
                      onClick={handleDownloadEmbedding}
                      disabled={isPullingEmbedding}
                      className="rounded-xl bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isPullingEmbedding ? 'Downloading...' : 'Download'}
                    </button>
                  )}
                </div>
                {ollama && !ollama.running && (
                  <p className="text-xs text-red-600">Ollama is not running — embeddings unavailable.</p>
                )}
                {embeddingPull && (
                  <div data-testid="embedding-progress-bar" className="w-full">
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-primary transition-all"
                        style={{ width: `${embeddingPull.percent}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {embeddingPull.error ?? `${embeddingPull.percent}% — ${embeddingPull.status}`}
                    </p>
                  </div>
                )}
              </div>
            )}

            {rerankerStatus?.available === false && (
              <p data-testid="reranker-unavailable-note" className="text-xs text-muted-foreground">
                Better ranking is not available in this build yet. Hybrid retrieval
                (vector + keyword) already covers most of the gap.
              </p>
            )}
            {rerankerStatus && rerankerStatus.available !== false && (
              <div
                data-testid="reranker-model-section"
                className="rounded-xl border bg-muted/40 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-foreground">Better ranking</p>
                    <p className="text-xs text-muted-foreground">
                      {rerankerStatus.model} — {rerankerStatus.size_mb} MB, runs locally.
                      Enabled automatically once downloaded.
                    </p>
                  </div>
                  {rerankerStatus.downloaded ? (
                    <span
                      data-testid="reranker-ready-indicator"
                      className="text-xs font-medium text-green-600"
                    >
                      ✓ Ready · enabled
                    </span>
                  ) : (
                    <button
                      data-testid="download-reranker-button"
                      onClick={handleRerankerDownload}
                      disabled={rerankerDownloading}
                      className="rounded-xl bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {rerankerDownloading ? 'Downloading...' : 'Download'}
                    </button>
                  )}
                </div>
                {rerankerDownloading && (
                  <div data-testid="reranker-progress-bar" className="w-full">
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-primary transition-all"
                        style={{ width: `${Math.round((rerankerDownloadStatus?.progress ?? 0) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Assistant: security boundary + personalization. */}
          <div className={cardClass}>
            <h3 className={sectionTitleClass}>Assistant</h3>
            <div>
              <label className={labelClass}>Agent Write Permissions</label>
              <select
                data-testid="permission-mode-select"
                value={config.chat_permission_mode}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    chat_permission_mode: e.target.value as AppConfig['chat_permission_mode'],
                  })
                }
                className={selectClass}
              >
                <option value="ask">Ask — confirm every create/update/delete</option>
                <option value="accept-edits">Accept edits — auto-approve edits, deletions still ask</option>
                <option value="readonly">Read only — the agent cannot modify notes</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Custom Instructions</label>
              <textarea
                data-testid="custom-system-prompt-input"
                value={config.custom_system_prompt}
                onChange={(e) => setConfig({ ...config, custom_system_prompt: e.target.value })}
                placeholder="Add custom instructions for the AI assistant (e.g., response style, domain expertise, language preferences)..."
                rows={4}
                className={inputClass + ' resize-y'}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Additional instructions appended to the system prompt. Leave empty to use defaults.
              </p>
            </div>
          </div>

          {showEmbeddingWarning && (
            <p data-testid="embedding-warning" className="text-sm text-amber-600">
              Warning: The selected embedding model is not downloaded. Ingestion may fail.
            </p>
          )}

          {/* Memory (Phase M3): what the assistant has learned about you */}
          <div data-testid="memory-section" className={cardClass}>
            <h3 className={sectionTitleClass}>Memory</h3>
            <p className="text-xs text-muted-foreground">
              Facts and standing instructions the assistant has learned from your conversations.
            </p>
            {memories.length === 0 ? (
              <p data-testid="memory-empty" className="text-xs text-muted-foreground">
                Nothing learned yet.
              </p>
            ) : (
              <ul data-testid="memory-list" className="space-y-1">
                {memories.map((m) => (
                  <li
                    key={m.id}
                    data-testid={`memory-item-${m.id}`}
                    className="group flex items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-accent/40"
                  >
                    <span className="rounded bg-accent px-1 text-[10px] uppercase text-accent-foreground">
                      {m.kind === 'procedural' ? 'rule' : 'fact'}
                    </span>
                    {editingMemory?.id === m.id ? (
                      <input
                        data-testid={`memory-edit-input-${m.id}`}
                        value={editingMemory.content}
                        onChange={(e) => setEditingMemory({ id: m.id, content: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveMemoryEdit()
                          if (e.key === 'Escape') setEditingMemory(null)
                        }}
                        className="flex-1 rounded border bg-background px-1 py-0.5 text-sm focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => setEditingMemory({ id: m.id, content: m.content })}
                        className="min-w-0 flex-1 truncate text-left text-foreground"
                        title="Click to edit"
                      >
                        {m.content}
                      </button>
                    )}
                    <button
                      data-testid={`memory-delete-${m.id}`}
                      onClick={() => deleteMemory(m.id)}
                      aria-label="Forget this memory"
                      className="hidden px-1 text-xs text-muted-foreground group-hover:block hover:text-red-500"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Data Management */}
          <div data-testid="data-management-section" className={cardClass}>
            <h3 className={sectionTitleClass}>Data</h3>
            <div className="flex gap-2">
              <button
                data-testid="export-all-button"
                onClick={handleExportAll}
                disabled={exporting}
                className="rounded-xl border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                {exporting ? 'Exporting...' : 'Export All'}
              </button>
              <button
                data-testid="export-chat-button"
                onClick={handleExportChat}
                disabled={exporting}
                className="rounded-xl border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                Export Chat
              </button>
            </div>
            {exportStatus && (
              <p data-testid="export-status" className="text-xs text-muted-foreground">
                {exportStatus}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              data-testid="save-button"
              onClick={handleSave}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
            <button
              data-testid="test-connection-button"
              onClick={handleTestConnection}
              disabled={testing}
              className="rounded-xl border bg-background/70 px-4 py-2 text-sm font-medium text-foreground backdrop-blur-sm hover:bg-accent disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          {/* Feedback */}
          {saveMessage && <p className="text-sm text-green-600">{saveMessage}</p>}
          {testResult && (
            <p className={`text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
              {testResult.success ? testResult.message : testResult.error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
