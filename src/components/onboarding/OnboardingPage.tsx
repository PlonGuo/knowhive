import { useCallback, useEffect, useState } from 'react'
import { fetchOllamaStatus, pullModel, type OllamaStatus } from '../../lib/ollama'

// R3 onboarding: pick "local Ollama" vs "cloud API", detect Ollama, one-click pull
// of required models with live progress streamed from POST /ollama/pull (NDJSON).

type Mode = 'local' | 'cloud'

interface LLMConfig {
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

interface PullProgress {
  model: string
  percent: number
  status: string
  error?: string
}

interface OnboardingPageProps {
  backendUrl: string
  onComplete: () => void
}

const OLLAMA_DEFAULTS: LLMConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3.2',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
}

const CLOUD_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  'openai-compatible': 'https://api.openai.com/v1',
}

const EMBEDDING_MODEL_BY_LANGUAGE: Record<LLMConfig['embedding_language'], string> = {
  english: 'nomic-embed-text',
  chinese: 'bge-m3',
  mixed: 'bge-m3',
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-muted-foreground">…</span>
  return ok
    ? <span className="text-green-500 font-bold">✓</span>
    : <span className="text-red-500 font-bold">✗</span>
}

export default function OnboardingPage({ backendUrl, onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState<Mode>('local')
  const [config, setConfig] = useState<LLMConfig>(OLLAMA_DEFAULTS)
  const [ollama, setOllama] = useState<OllamaStatus | null>(null)
  const [pull, setPull] = useState<PullProgress | null>(null)
  const [pulling, setPulling] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  const saveConfig = useCallback(
    async (cfg: LLMConfig) => {
      await fetch(`${backendUrl}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
    },
    [backendUrl],
  )

  // /ollama/status derives the required models from the *saved* config, so push the
  // draft config first, then ask.
  const refreshOllama = useCallback(
    async (cfg: LLMConfig) => {
      setOllama(null)
      try {
        await saveConfig(cfg)
        setOllama(await fetchOllamaStatus(backendUrl))
      } catch {
        setOllama({ running: false, models: [], required: [] })
      }
    },
    [backendUrl, saveConfig],
  )

  useEffect(() => {
    if (step === 2) refreshOllama(config)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on entering step 2 only
  }, [step])

  const handleDownloadMissing = async () => {
    if (!ollama) return
    setPulling(true)
    try {
      for (const req of (ollama.required ?? []).filter((r) => !r.installed)) {
        setPull({ model: req.name, percent: 0, status: 'starting' })
        const result = await pullModel(backendUrl, req.name, (percent, status) =>
          setPull({ model: req.name, percent, status }),
        )
        if (!result.ok) {
          setPull({ model: req.name, percent: 0, status: 'error', error: result.error })
          break
        }
      }
      await refreshOllama(config)
    } finally {
      setPulling(false)
      setPull(null)
    }
  }

  const handleTestConnection = async () => {
    setTestResult(null)
    setTesting(true)
    try {
      await saveConfig(config)
      const res = await fetch(`${backendUrl}/config/test-llm`, { method: 'POST' })
      setTestResult(await res.json())
    } catch {
      setTestResult({ success: false, error: 'Request failed' })
    } finally {
      setTesting(false)
    }
  }

  const handleFinish = async () => {
    try {
      await saveConfig(config)
      await fetch(`${backendUrl}/setup/complete`, { method: 'POST' })
    } catch {
      // proceed anyway — the app can still be configured from Settings
    }
    onComplete()
  }

  const selectMode = (m: Mode) => {
    setMode(m)
    setTestResult(null)
    setConfig(
      m === 'local'
        ? OLLAMA_DEFAULTS
        : {
            ...config,
            llm_provider: 'anthropic',
            model_name: 'claude-sonnet-4-6',
            base_url: CLOUD_BASE_URLS.anthropic!,
          },
    )
    setStep(2)
  }

  const inputClass =
    'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
  const labelClass = 'block text-sm font-medium text-foreground mb-1'

  const allModelsReady = ollama?.running === true && (ollama.required ?? []).every((r) => r.installed)

  // ── Step 1: choose mode ─────────────────────────────────────────
  if (step === 1) {
    return (
      <div data-testid="onboarding-page" className="flex flex-1 flex-col items-center justify-center gap-8 p-12">
        <h1 className="font-serif text-3xl font-semibold">Welcome to KnowHive</h1>
        <p className="text-muted-foreground">How do you want to run your AI model?</p>

        <div className="flex gap-6">
          <button
            data-testid="onboarding-mode-local"
            onClick={() => selectMode('local')}
            className="w-64 rounded-lg border border bg-background/80 backdrop-blur-sm p-6 text-left shadow-sm hover:border-primary hover:shadow"
          >
            <div className="text-lg font-semibold mb-1">Local (Ollama)</div>
            <p className="text-sm text-muted-foreground">
              Private and free. Runs models on your machine via Ollama. We'll detect it and
              download what's needed.
            </p>
          </button>
          <button
            data-testid="onboarding-mode-cloud"
            onClick={() => selectMode('cloud')}
            className="w-64 rounded-lg border border bg-background/80 backdrop-blur-sm p-6 text-left shadow-sm hover:border-primary hover:shadow"
          >
            <div className="text-lg font-semibold mb-1">Cloud API</div>
            <p className="text-sm text-muted-foreground">
              Use Anthropic or any OpenAI-compatible API with your own key. Embeddings still run
              locally through Ollama.
            </p>
          </button>
        </div>
      </div>
    )
  }

  // ── Step 2: configure + model readiness ─────────────────────────
  if (step === 2) {
    return (
      <div data-testid="onboarding-step2" className="flex flex-1 flex-col items-center justify-center gap-6 p-12">
        <h1 className="font-serif text-3xl font-semibold">{mode === 'local' ? 'Set up Ollama' : 'Configure your API'}</h1>

        <div className="w-full max-w-md rounded-lg border border bg-background/80 backdrop-blur-sm p-6 shadow-sm space-y-4">
          {mode === 'cloud' && (
            <>
              <div>
                <label className={labelClass}>Provider</label>
                <select
                  data-testid="onboarding-provider-select"
                  value={config.llm_provider}
                  onChange={(e) => {
                    const provider = e.target.value as LLMConfig['llm_provider']
                    setConfig({
                      ...config,
                      llm_provider: provider,
                      base_url: CLOUD_BASE_URLS[provider] ?? config.base_url,
                      model_name: provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini',
                    })
                  }}
                  className={inputClass}
                >
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="openai-compatible">OpenAI Compatible</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Model Name</label>
                <input
                  data-testid="onboarding-model-input"
                  type="text"
                  value={config.model_name}
                  onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Base URL</label>
                <input
                  data-testid="onboarding-base-url-input"
                  type="text"
                  value={config.base_url}
                  onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>API Key</label>
                <input
                  data-testid="onboarding-api-key-input"
                  type="password"
                  value={config.api_key ?? ''}
                  onChange={(e) => setConfig({ ...config, api_key: e.target.value || null })}
                  placeholder="sk-..."
                  className={inputClass}
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  data-testid="onboarding-test-btn"
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  {testing ? 'Testing…' : 'Test Connection'}
                </button>
                {testResult && (
                  <span
                    data-testid="onboarding-test-result"
                    className={`text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {testResult.success ? testResult.message : testResult.error}
                  </span>
                )}
              </div>
              <hr />
            </>
          )}

          {mode === 'local' && (
            <div>
              <label className={labelClass}>Chat Model</label>
              <input
                data-testid="onboarding-model-input"
                type="text"
                value={config.model_name}
                onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label className={labelClass}>Knowledge Base Language (embeddings)</label>
            <select
              data-testid="onboarding-language-select"
              value={config.embedding_language}
              onChange={(e) => {
                const embedding_language = e.target.value as LLMConfig['embedding_language']
                const next = { ...config, embedding_language }
                setConfig(next)
                refreshOllama(next)
              }}
              className={inputClass}
            >
              <option value="english">English (nomic-embed-text)</option>
              <option value="chinese">Chinese (bge-m3)</option>
              <option value="mixed">Mixed / 中英混合 (bge-m3)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Embeddings always run locally via Ollama ({EMBEDDING_MODEL_BY_LANGUAGE[config.embedding_language]}).
            </p>
          </div>

          {/* Ollama readiness panel */}
          <div data-testid="onboarding-ollama-panel" className="rounded-md bg-muted/60 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Ollama</span>
              <div className="flex items-center gap-2">
                <StatusIcon ok={ollama ? ollama.running : null} />
                <button
                  data-testid="onboarding-ollama-refresh"
                  onClick={() => refreshOllama(config)}
                  className="text-xs text-primary underline"
                >
                  Refresh
                </button>
              </div>
            </div>
            {ollama && !ollama.running && (
              <p className="text-sm text-red-600">
                Ollama is not running.{' '}
                <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="underline">
                  Install Ollama
                </a>{' '}
                and start it, then hit Refresh.
              </p>
            )}
            {ollama?.running &&
              (ollama.required ?? []).map((r) => (
                <div key={r.name} data-testid={`onboarding-model-${r.purpose}`} className="flex items-center justify-between text-sm">
                  <span>
                    {r.name} <span className="text-muted-foreground">({r.purpose})</span>
                  </span>
                  <StatusIcon ok={r.installed} />
                </div>
              ))}
            {ollama?.running && !allModelsReady && !pulling && (
              <button
                data-testid="onboarding-download-btn"
                onClick={handleDownloadMissing}
                className="w-full rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground font-medium"
              >
                Download missing models
              </button>
            )}
            {pull && (
              <div data-testid="onboarding-pull-progress" className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {pull.model} — {pull.error ?? pull.status}
                  </span>
                  <span>{pull.percent}%</span>
                </div>
                <div className="h-2 w-full rounded bg-muted">
                  <div
                    className="h-2 rounded bg-primary transition-all"
                    style={{ width: `${pull.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            data-testid="onboarding-back-btn"
            onClick={() => setStep(1)}
            className="rounded-md border px-6 py-2 font-medium"
          >
            Back
          </button>
          <button
            data-testid="onboarding-step2-next-btn"
            disabled={!allModelsReady || pulling}
            onClick={async () => {
              await saveConfig(config)
              setStep(3)
            }}
            className="rounded-md bg-primary px-6 py-2 text-primary-foreground font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    )
  }

  // ── Step 3: done ────────────────────────────────────────────────
  return (
    <div data-testid="onboarding-step3" className="flex flex-1 flex-col items-center justify-center gap-6 p-12">
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
        <span className="text-green-600 text-3xl font-bold">✓</span>
      </div>
      <h1 className="font-serif text-3xl font-semibold">All Set!</h1>
      <p className="text-muted-foreground text-center max-w-sm">
        KnowHive is ready. You can always change these settings later.
      </p>

      <div
        data-testid="onboarding-summary"
        className="w-full max-w-md rounded-lg border border bg-background/80 backdrop-blur-sm p-4 shadow-sm space-y-2 text-sm text-foreground"
      >
        <div className="flex justify-between">
          <span className="text-muted-foreground">Mode</span>
          <span>{mode === 'local' ? 'Local (Ollama)' : 'Cloud API'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Provider</span>
          <span>{config.llm_provider}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Chat Model</span>
          <span>{config.model_name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Embedding</span>
          <span>{EMBEDDING_MODEL_BY_LANGUAGE[config.embedding_language]}</span>
        </div>
      </div>

      <button
        data-testid="onboarding-finish-btn"
        onClick={handleFinish}
        className="rounded-md bg-primary px-8 py-2 text-primary-foreground font-medium"
      >
        Get Started
      </button>
    </div>
  )
}
