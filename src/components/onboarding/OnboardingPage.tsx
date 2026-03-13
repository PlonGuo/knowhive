import { useEffect, useState } from 'react'

interface SetupStatus {
  python_ok: boolean
  uv_ok: boolean
  ollama_ok: boolean
  first_run: boolean
}

interface LLMConfig {
  llm_provider: 'ollama' | 'openai-compatible' | 'anthropic'
  model_name: string
  base_url: string
  api_key: string | null
  embedding_language: string
}

interface TestResult {
  success: boolean
  message?: string
  error?: string
}

interface OnboardingPageProps {
  backendUrl: string
  onComplete: () => void
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-gray-400">…</span>
  return ok
    ? <span className="text-green-500 font-bold">✓</span>
    : <span className="text-red-500 font-bold">✗</span>
}

const defaultConfig: LLMConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
}

export default function OnboardingPage({ backendUrl, onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState(1)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [config, setConfig] = useState<LLMConfig>(defaultConfig)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    fetch(`${backendUrl}/setup/status`)
      .then((r) => r.json())
      .then((data: SetupStatus) => setStatus(data))
      .catch(() => {})
  }, [backendUrl])

  useEffect(() => {
    if (step === 2) {
      fetch(`${backendUrl}/config`)
        .then((r) => r.json())
        .then((data: LLMConfig) => setConfig(data))
        .catch(() => {})
    }
  }, [backendUrl, step])

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

  const handleStep2Next = async () => {
    try {
      await fetch(`${backendUrl}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
    } catch {
      // proceed anyway
    }
    setStep(3)
  }

  const inputClass =
    'w-full rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  const selectClass =
    'w-full rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

  if (step === 1) {
    return (
      <div data-testid="onboarding-page" className="flex flex-1 flex-col items-center justify-center gap-8 p-12">
        <h1 className="text-2xl font-bold">Welcome to KnowHive</h1>
        <p className="text-gray-500">Let's check your dependencies before getting started.</p>

        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div data-testid="dep-python" className="flex items-center justify-between">
            <span className="font-medium">Python 3.11+</span>
            <StatusIcon ok={status ? status.python_ok : null} />
          </div>

          <div data-testid="dep-uv" className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">uv (package manager)</span>
              <StatusIcon ok={status ? status.uv_ok : null} />
            </div>
            {status && !status.uv_ok && (
              <p className="text-sm text-red-600">
                uv is required.{' '}
                <a
                  href="https://docs.astral.sh/uv/getting-started/installation/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Install uv
                </a>
              </p>
            )}
          </div>

          <div data-testid="dep-ollama" className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">Ollama (optional)</span>
              <StatusIcon ok={status ? status.ollama_ok : null} />
            </div>
            {status && !status.ollama_ok && (
              <p className="text-sm text-yellow-600">
                Ollama not detected — you can configure another LLM provider in settings.
              </p>
            )}
          </div>
        </div>

        <button
          data-testid="onboarding-next-btn"
          disabled={status?.uv_ok !== true}
          onClick={() => setStep(2)}
          className="rounded-md bg-blue-600 px-6 py-2 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    )
  }

  if (step === 2) {
    return (
      <div data-testid="onboarding-step2" className="flex flex-1 flex-col items-center justify-center gap-6 p-12">
        <h1 className="text-2xl font-bold">Configure your LLM</h1>
        <p className="text-gray-500">Choose a provider and enter connection details.</p>

        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div>
            <label className={labelClass}>LLM Provider</label>
            <select
              data-testid="onboarding-provider-select"
              value={config.llm_provider}
              onChange={(e) =>
                setConfig({ ...config, llm_provider: e.target.value as LLMConfig['llm_provider'] })
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

          {(config.llm_provider === 'openai-compatible' || config.llm_provider === 'anthropic') && (
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
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              data-testid="onboarding-test-btn"
              onClick={handleTestConnection}
              disabled={testing}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
          </div>

          {testResult && (
            <p
              data-testid="onboarding-test-result"
              className={`text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}
            >
              {testResult.success ? testResult.message : testResult.error}
            </p>
          )}
        </div>

        <button
          data-testid="onboarding-step2-next-btn"
          onClick={handleStep2Next}
          className="rounded-md bg-blue-600 px-6 py-2 text-white font-medium"
        >
          Next
        </button>
      </div>
    )
  }

  if (step === 3) {
    const handleFinish = async () => {
      try {
        await fetch(`${backendUrl}/setup/complete`, { method: 'POST' })
      } catch {
        // proceed anyway
      }
      onComplete()
    }

    return (
      <div data-testid="onboarding-step3" className="flex flex-1 flex-col items-center justify-center gap-6 p-12">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
          <span className="text-green-600 text-3xl font-bold">✓</span>
        </div>
        <h1 className="text-2xl font-bold">All Set!</h1>
        <p className="text-gray-500 text-center max-w-sm">
          KnowHive is ready. You can always change these settings later.
        </p>

        <div
          data-testid="onboarding-summary"
          className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-2 text-sm text-gray-700"
        >
          <div className="flex justify-between">
            <span className="text-gray-500">Python</span>
            <span>{status?.python_ok ? '✓ OK' : '✗ Missing'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">uv</span>
            <span>{status?.uv_ok ? '✓ OK' : '✗ Missing'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Ollama</span>
            <span>{status?.ollama_ok ? '✓ Detected' : '— Not detected'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">LLM Provider</span>
            <span>{config.llm_provider}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Model</span>
            <span>{config.model_name}</span>
          </div>
        </div>

        <button
          data-testid="onboarding-finish-btn"
          onClick={handleFinish}
          className="rounded-md bg-blue-600 px-8 py-2 text-white font-medium"
        >
          Get Started
        </button>
      </div>
    )
  }

  return null
}
