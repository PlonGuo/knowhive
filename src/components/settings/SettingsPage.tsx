import { useEffect, useRef, useState } from 'react'

interface AppConfig {
  llm_provider: 'ollama' | 'openai-compatible' | 'anthropic'
  model_name: string
  base_url: string
  api_key: string | null
  embedding_language: 'english' | 'chinese' | 'mixed'
}

interface TestResult {
  success: boolean
  message?: string
  error?: string
}

interface EmbeddingModel {
  language: string
  name: string
  size_mb: number
  downloaded: boolean
}

interface EmbeddingStatus {
  language?: string
  status: string | null
  progress?: number
}

interface SettingsPageProps {
  backendUrl: string
  onBack?: () => void
  onConfigSaved?: () => void
}

const defaultConfig: AppConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
}

export default function SettingsPage({ backendUrl, onBack, onConfigSaved }: SettingsPageProps) {
  const [config, setConfig] = useState<AppConfig>(defaultConfig)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModel[]>([])
  const [downloadStatus, setDownloadStatus] = useState<EmbeddingStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [showEmbeddingWarning, setShowEmbeddingWarning] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch(`${backendUrl}/config`)
      .then((r) => r.json())
      .then((data: AppConfig) => setConfig(data))
      .catch(() => {})
  }, [backendUrl])

  useEffect(() => {
    fetch(`${backendUrl}/embedding/models`)
      .then((r) => r.ok ? r.json() : Promise.resolve([]))
      .then((data: EmbeddingModel[]) => {
        if (Array.isArray(data)) setEmbeddingModels(data)
      })
      .catch(() => {})
  }, [backendUrl])

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const currentModel = embeddingModels.find((m) => m.language === config.embedding_language)

  const startStatusPolling = (language: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${backendUrl}/embedding/status?language=${language}`)
        const data: EmbeddingStatus = await res.json()
        setDownloadStatus(data)
        if (data.status === 'complete' || data.status === 'error') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setDownloading(false)
          // Refresh model list
          const modelsRes = await fetch(`${backendUrl}/embedding/models`)
          const models: EmbeddingModel[] = await modelsRes.json()
          setEmbeddingModels(models)
        }
      } catch {
        clearInterval(pollRef.current!)
        pollRef.current = null
        setDownloading(false)
      }
    }, 1000)
  }

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadStatus({ status: 'downloading', progress: 0 })
    try {
      await fetch(`${backendUrl}/embedding/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: config.embedding_language }),
      })
      startStatusPolling(config.embedding_language)
    } catch {
      setDownloading(false)
    }
  }

  const handleSave = async () => {
    setSaveMessage(null)
    setTestResult(null)
    setShowEmbeddingWarning(false)

    // Warn if selected model is not downloaded
    if (currentModel && !currentModel.downloaded) {
      setShowEmbeddingWarning(true)
    }

    try {
      await fetch(`${backendUrl}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      setSaveMessage('Settings saved')
      onConfigSaved?.()
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
      const savePath = await window.api?.saveFile?.(defaultName)
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

  const isDownloading = downloading || downloadStatus?.status === 'downloading'
  const downloadProgress = downloadStatus?.progress ?? 0

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
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
        </div>

        <div className="space-y-5">
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

          {/* Embedding Model Info */}
          {currentModel && (
            <div
              data-testid="embedding-model-section"
              className="rounded-md border bg-muted/40 p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {currentModel.name} — {currentModel.size_mb} MB
                </span>
                {currentModel.downloaded ? (
                  <span
                    data-testid="embedding-ready-indicator"
                    className="text-xs font-medium text-green-600"
                  >
                    ✓ Ready
                  </span>
                ) : (
                  <button
                    data-testid="download-embedding-button"
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isDownloading ? 'Downloading...' : 'Download'}
                  </button>
                )}
              </div>
              {isDownloading && (
                <div data-testid="embedding-progress-bar" className="w-full">
                  <div className="h-1.5 w-full rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-primary transition-all"
                      style={{ width: `${Math.round(downloadProgress * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {Math.round(downloadProgress * 100)}% downloaded
                  </p>
                </div>
              )}
            </div>
          )}

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
          <div data-testid="data-management-section" className="rounded-md border p-3 space-y-2">
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
