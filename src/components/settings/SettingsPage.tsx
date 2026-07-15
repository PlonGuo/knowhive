import { useEffect, useRef, useState } from 'react'
import { fetchOllamaStatus, pullModel, type OllamaStatus } from '../../lib/ollama'
import { saveFile } from '../../lib/platform'

interface AppConfig {
  llm_provider: 'ollama' | 'openai-compatible' | 'anthropic'
  model_name: string
  base_url: string
  api_key: string | null
  embedding_language: 'english' | 'chinese' | 'mixed'
  pre_retrieval_strategy: 'none' | 'hyde' | 'multi_query' | 'auto' | 'auto_llm'
  use_reranker: boolean
  chat_mode: 'single' | 'agentic'
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
  chat_memory_turns: 0,
  custom_system_prompt: '',
}

export default function SettingsPage({ backendUrl, onBack, onConfigSaved }: SettingsPageProps) {
  const [config, setConfig] = useState<AppConfig>(defaultConfig)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [ollama, setOllama] = useState<OllamaStatus | null>(null)
  const [embeddingPull, setEmbeddingPull] = useState<EmbeddingPull | null>(null)
  const [showEmbeddingWarning, setShowEmbeddingWarning] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [rerankerStatus, setRerankerStatus] = useState<RerankerStatus | null>(null)
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
      .then((r) => r.ok ? r.json() : Promise.resolve(null))
      .then((data: RerankerStatus | null) => {
        if (data) setRerankerStatus(data)
      })
      .catch(() => {})
  }, [backendUrl])

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

  const startRerankerPolling = () => {
    if (rerankerPollRef.current) clearInterval(rerankerPollRef.current)
    rerankerPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${backendUrl}/reranker/download-status`)
        const data: RerankerDownloadStatus = await res.json()
        setRerankerDownloadStatus(data)
        if (data.status === 'complete' || data.status === 'error') {
          clearInterval(rerankerPollRef.current!)
          rerankerPollRef.current = null
          setRerankerDownloading(false)
          const statusRes = await fetch(`${backendUrl}/reranker/status`)
          const status: RerankerStatus = await statusRes.json()
          setRerankerStatus(status)
        }
      } catch {
        clearInterval(rerankerPollRef.current!)
        rerankerPollRef.current = null
        setRerankerDownloading(false)
      }
    }, 1000)
  }

  const handleRerankerDownload = async () => {
    setRerankerDownloading(true)
    setRerankerDownloadStatus({ status: 'downloading', progress: 0 })
    try {
      await fetch(`${backendUrl}/reranker/download`, { method: 'POST' })
      startRerankerPolling()
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

  const inputClass =
    'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
  const labelClass = 'block text-sm font-medium text-foreground mb-1'
  const selectClass =
    'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

  const isPullingEmbedding = embeddingPull !== null && !embeddingPull.error

  return (
    <div data-testid="settings-page" className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <button
            data-testid="settings-back-button"
            onClick={onBack}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            &larr; Back
          </button>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Settings</h1>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border bg-background/60 p-4 backdrop-blur-sm space-y-3">
          <h3 className="text-sm font-medium text-foreground">Model</h3>
          {/* LLM Provider */}
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

          {/* Model Name */}
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

          {/* Base URL */}
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

          {/* API Key (conditional) */}
          {(config.llm_provider === 'openai-compatible' || config.llm_provider === 'anthropic') && (
            <div>
              <label className={labelClass}>API Key</label>
              <input
                data-testid="api-key-input"
                type="password"
                value={config.api_key ?? ''}
                onChange={(e) =>
                  setConfig({ ...config, api_key: e.target.value || null })
                }
                className={inputClass}
                placeholder="sk-..."
              />
            </div>
          )}

          {/* Embedding Language */}
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

          {/* Embedding Model Info (served by local Ollama) */}
          {embeddingModel && (
            <div
              data-testid="embedding-model-section"
              className="rounded-md border bg-muted/40 p-3 space-y-2"
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
                    className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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

          </div>

          {/* RAG Settings */}
          <div className="rounded-xl border bg-background/60 p-4 backdrop-blur-sm space-y-3">
            <h3 className="text-sm font-medium text-foreground">RAG Settings</h3>

            {/* Pre-retrieval Strategy */}
            <div>
              <label className={labelClass}>Pre-retrieval Strategy</label>
              <select
                data-testid="pre-retrieval-strategy-select"
                value={config.pre_retrieval_strategy}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    pre_retrieval_strategy: e.target.value as AppConfig['pre_retrieval_strategy'],
                  })
                }
                className={selectClass}
              >
                <option value="none">None — direct retrieval, no preprocessing</option>
                <option value="hyde">HyDE — generates hypothetical doc for better matching</option>
                <option value="multi_query">Multi-Query — expands into multiple search variants</option>
                <option value="auto">Auto — rule-based strategy selection (fast, no LLM call)</option>
                <option value="auto_llm">Auto (LLM) — LLM picks the best strategy (slower, more accurate)</option>
              </select>
            </div>

            {/* Agent Mode Toggle (Phase G: /chat tool-use loop) */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-foreground">Agent Mode</label>
                <p className="text-xs text-muted-foreground">
                  Let the AI search and read notes on its own for multi-hop questions
                </p>
              </div>
              <button
                data-testid="chat-mode-toggle"
                onClick={() =>
                  setConfig({
                    ...config,
                    chat_mode: config.chat_mode === 'agentic' ? 'single' : 'agentic',
                  })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config.chat_mode === 'agentic' ? 'bg-primary' : 'bg-muted'
                }`}
                role="switch"
                aria-checked={config.chat_mode === 'agentic'}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.chat_mode === 'agentic' ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Reranker Toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">Use Reranker</label>
              <button
                data-testid="reranker-toggle"
                onClick={() => setConfig({ ...config, use_reranker: !config.use_reranker })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config.use_reranker ? 'bg-primary' : 'bg-muted'
                }`}
                role="switch"
                aria-checked={config.use_reranker}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.use_reranker ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Reranker Model Download */}
            {config.use_reranker && rerankerStatus?.available === false && (
              <p data-testid="reranker-unavailable-note" className="text-xs text-muted-foreground">
                Reranking is not available in this build yet (planned: Phase E). Hybrid retrieval
                (vector + keyword) already covers most of the gap.
              </p>
            )}
            {config.use_reranker && rerankerStatus && rerankerStatus.available !== false && (
              <div
                data-testid="reranker-model-section"
                className="rounded-md border bg-muted/40 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {rerankerStatus.model} — {rerankerStatus.size_mb} MB
                  </span>
                  {rerankerStatus.downloaded ? (
                    <span
                      data-testid="reranker-ready-indicator"
                      className="text-xs font-medium text-green-600"
                    >
                      ✓ Ready
                    </span>
                  ) : (
                    <button
                      data-testid="download-reranker-button"
                      onClick={handleRerankerDownload}
                      disabled={rerankerDownloading}
                      className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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

            {/* Chat Memory Turns */}
            <div>
              <label className={labelClass}>Chat Memory Turns</label>
              <input
                data-testid="chat-memory-turns-input"
                type="number"
                min={0}
                max={50}
                value={config.chat_memory_turns}
                onChange={(e) =>
                  setConfig({ ...config, chat_memory_turns: Math.max(0, parseInt(e.target.value) || 0) })
                }
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Number of recent messages to include for context (0 = disabled)
              </p>
            </div>

            {/* Custom Instructions */}
            <div>
              <label className={labelClass}>Custom Instructions</label>
              <textarea
                data-testid="custom-system-prompt-input"
                value={config.custom_system_prompt}
                onChange={(e) =>
                  setConfig({ ...config, custom_system_prompt: e.target.value })
                }
                placeholder="Add custom instructions for the AI assistant (e.g., response style, domain expertise, language preferences)..."
                rows={4}
                className={inputClass + ' resize-y'}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Additional instructions appended to the system prompt. Leave empty to use defaults.
              </p>
            </div>
          </div>

          {/* Embedding warning */}
          {showEmbeddingWarning && (
            <p
              data-testid="embedding-warning"
              className="text-sm text-amber-600"
            >
              Warning: The selected embedding model is not downloaded. Ingestion may fail.
            </p>
          )}

          {/* Data Management */}
          <div data-testid="data-management-section" className="rounded-xl border bg-background/60 p-4 backdrop-blur-sm space-y-2">
            <h3 className="text-sm font-medium text-foreground">Data Management</h3>
            <div className="flex gap-2">
              <button
                data-testid="export-all-button"
                onClick={handleExportAll}
                disabled={exporting}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                {exporting ? 'Exporting...' : 'Export All'}
              </button>
              <button
                data-testid="export-chat-button"
                onClick={handleExportChat}
                disabled={exporting}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
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
          <div className="flex gap-3 pt-2">
            <button
              data-testid="save-button"
              onClick={handleSave}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
            <button
              data-testid="test-connection-button"
              onClick={handleTestConnection}
              disabled={testing}
              className="rounded-md border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          {/* Feedback */}
          {saveMessage && (
            <p className="text-sm text-green-600">{saveMessage}</p>
          )}
          {testResult && (
            <p
              className={`text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}
            >
              {testResult.success ? testResult.message : testResult.error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
