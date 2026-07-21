// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import OnboardingPage from '../../src/components/onboarding/OnboardingPage'

// R3 onboarding: mode choice (local Ollama vs cloud API), Ollama detection,
// one-click model pull with streamed progress, completion via /setup/complete.

const BACKEND_URL = 'http://127.0.0.1:18200'

interface MockState {
  running: boolean
  installed: boolean
  pulledModels: string[]
  putConfigs: unknown[]
  setupCompleted: boolean
}

function ndjsonBody(lines: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(line) + '\n'))
      }
      controller.close()
    },
  })
}

/** Stateful backend fake: pulling a model marks everything installed. */
function mockBackend(over: Partial<MockState> = {}): MockState {
  const state: MockState = {
    running: true,
    installed: true,
    pulledModels: [],
    putConfigs: [],
    setupCompleted: false,
    ...over,
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/ollama/status')) {
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            running: state.running,
            models: state.installed ? ['llama3.2:latest', 'nomic-embed-text:latest'] : [],
            required: [
              { name: 'llama3.2', purpose: 'chat', installed: state.installed },
              { name: 'nomic-embed-text', purpose: 'embedding', installed: state.installed },
            ],
          }),
      } as Response
    }
    if (url.includes('/ollama/pull')) {
      const { model } = JSON.parse(init!.body as string)
      state.pulledModels.push(model)
      state.installed = true
      return {
        ok: true,
        body: ndjsonBody([
          { status: 'pulling manifest' },
          { status: 'downloading', total: 100, completed: 50 },
          { status: 'success' },
        ]),
      } as unknown as Response
    }
    if (url.includes('/config/test-llm')) {
      return { ok: true, json: () => Promise.resolve({ success: true, message: 'LLM connection successful' }) } as Response
    }
    if (url.includes('/config')) {
      if (init?.method === 'PUT') state.putConfigs.push(JSON.parse(init.body as string))
      return { ok: true, json: () => Promise.resolve({}) } as Response
    }
    if (url.includes('/setup/complete')) {
      state.setupCompleted = true
      return { ok: true, json: () => Promise.resolve({ ok: true }) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
  return state
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OnboardingPage — step 1 (mode choice)', () => {
  it('offers local and cloud modes', () => {
    mockBackend()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    expect(screen.getByTestId('onboarding-mode-local')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-mode-cloud')).toBeInTheDocument()
  })
})

describe('OnboardingPage — local mode', () => {
  it('saves the draft config then shows required models with their status', async () => {
    const state = mockBackend()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    fireEvent.click(screen.getByTestId('onboarding-mode-local'))
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-model-chat')).toHaveTextContent('llama3.2')
      expect(screen.getByTestId('onboarding-model-embedding')).toHaveTextContent('nomic-embed-text')
    })
    expect(state.putConfigs.length).toBeGreaterThan(0)
    expect((state.putConfigs[0] as { llm_provider: string }).llm_provider).toBe('ollama')
  })

  it('enables Next when Ollama runs and all models are installed', async () => {
    mockBackend()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    fireEvent.click(screen.getByTestId('onboarding-mode-local'))
    await waitFor(() => expect(screen.getByTestId('onboarding-step2-next-btn')).not.toBeDisabled())
    expect(screen.queryByTestId('onboarding-download-btn')).not.toBeInTheDocument()
  })

  it('shows an install hint and keeps Next disabled when Ollama is down', async () => {
    mockBackend({ running: false, installed: false })
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    fireEvent.click(screen.getByTestId('onboarding-mode-local'))
    await waitFor(() => {
      expect(screen.getByText(/Ollama is not running/)).toBeInTheDocument()
    })
    expect(screen.getByTestId('onboarding-step2-next-btn')).toBeDisabled()
  })

  it('downloads missing models via the streaming pull and then enables Next', async () => {
    const state = mockBackend({ installed: false })
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    fireEvent.click(screen.getByTestId('onboarding-mode-local'))
    await waitFor(() => screen.getByTestId('onboarding-download-btn'))
    expect(screen.getByTestId('onboarding-step2-next-btn')).toBeDisabled()

    fireEvent.click(screen.getByTestId('onboarding-download-btn'))
    await waitFor(() => expect(screen.getByTestId('onboarding-step2-next-btn')).not.toBeDisabled())
    // Both missing models were pulled (status flips installed after the first, but the
    // required list snapshot drives the loop).
    expect(state.pulledModels).toEqual(['llama3.2', 'nomic-embed-text'])
  })
})

describe('OnboardingPage — cloud mode', () => {
  it('shows provider/key fields and still requires the local embedding model', async () => {
    mockBackend()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    fireEvent.click(screen.getByTestId('onboarding-mode-cloud'))
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-provider-select')).toBeInTheDocument()
      expect(screen.getByTestId('onboarding-api-key-input')).toBeInTheDocument()
      expect(screen.getByTestId('onboarding-ollama-panel')).toBeInTheDocument()
    })
  })

  it('test connection saves config then reports the probe result', async () => {
    const state = mockBackend()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    fireEvent.click(screen.getByTestId('onboarding-mode-cloud'))
    await waitFor(() => screen.getByTestId('onboarding-test-btn'))
    fireEvent.click(screen.getByTestId('onboarding-test-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-test-result')).toHaveTextContent('LLM connection successful')
    })
    expect((state.putConfigs.at(-1) as { llm_provider: string }).llm_provider).toBe('anthropic')
  })
})

describe('OnboardingPage — completion', () => {
  it('finishing saves config, calls /setup/complete and onComplete', async () => {
    const state = mockBackend()
    const onComplete = vi.fn()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={onComplete} />)
    fireEvent.click(screen.getByTestId('onboarding-mode-local'))
    await waitFor(() => expect(screen.getByTestId('onboarding-step2-next-btn')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('onboarding-step2-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step3'))
    expect(screen.getByTestId('onboarding-summary')).toHaveTextContent('llama3.2')

    fireEvent.click(screen.getByTestId('onboarding-finish-btn'))
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(state.setupCompleted).toBe(true)
  })
})
