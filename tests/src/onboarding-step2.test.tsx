// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import OnboardingPage from '../../src/components/onboarding/OnboardingPage'

const BACKEND_URL = 'http://127.0.0.1:18200'

const defaultConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/setup/status')) {
      return { ok: true, json: () => Promise.resolve({ python_ok: true, uv_ok: true, ollama_ok: true, first_run: true }) } as Response
    }
    if (url.includes('/config/test-llm')) {
      return { ok: true, json: () => Promise.resolve(overrides['test-llm'] ?? { success: true, message: 'Connected' }) } as Response
    }
    if (url.includes('/config')) {
      return { ok: true, json: () => Promise.resolve(overrides['config'] ?? defaultConfig) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
}

async function renderStep2(overrides: Record<string, unknown> = {}) {
  mockFetch(overrides)
  render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
  // Wait for status to load, then click Next
  await waitFor(() => {
    expect(screen.getByTestId('onboarding-next-btn')).not.toBeDisabled()
  })
  fireEvent.click(screen.getByTestId('onboarding-next-btn'))
  await waitFor(() => {
    expect(screen.getByTestId('onboarding-step2')).toBeInTheDocument()
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OnboardingPage — Step 2 (LLM configuration)', () => {
  it('shows step 2 container after clicking Next', async () => {
    await renderStep2()
    expect(screen.getByTestId('onboarding-step2')).toBeInTheDocument()
  })

  it('shows LLM provider selector', async () => {
    await renderStep2()
    expect(screen.getByTestId('onboarding-provider-select')).toBeInTheDocument()
  })

  it('shows model name input', async () => {
    await renderStep2()
    expect(screen.getByTestId('onboarding-model-input')).toBeInTheDocument()
  })

  it('shows base URL input', async () => {
    await renderStep2()
    expect(screen.getByTestId('onboarding-base-url-input')).toBeInTheDocument()
  })

  it('hides API key input for Ollama provider', async () => {
    await renderStep2({ config: { ...defaultConfig, llm_provider: 'ollama' } })
    expect(screen.queryByTestId('onboarding-api-key-input')).not.toBeInTheDocument()
  })

  it('shows API key input for openai-compatible provider', async () => {
    await renderStep2()
    // Change provider to openai-compatible
    fireEvent.change(screen.getByTestId('onboarding-provider-select'), {
      target: { value: 'openai-compatible' },
    })
    expect(screen.getByTestId('onboarding-api-key-input')).toBeInTheDocument()
  })

  it('shows API key input for anthropic provider', async () => {
    await renderStep2()
    fireEvent.change(screen.getByTestId('onboarding-provider-select'), {
      target: { value: 'anthropic' },
    })
    expect(screen.getByTestId('onboarding-api-key-input')).toBeInTheDocument()
  })

  it('shows Test Connection button', async () => {
    await renderStep2()
    expect(screen.getByTestId('onboarding-test-btn')).toBeInTheDocument()
  })

  it('shows success message after successful test connection', async () => {
    await renderStep2({ 'test-llm': { success: true, message: 'Connected' } })
    fireEvent.click(screen.getByTestId('onboarding-test-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-test-result')).toHaveTextContent('Connected')
    })
  })

  it('shows error message after failed test connection', async () => {
    await renderStep2({ 'test-llm': { success: false, error: 'Connection refused' } })
    fireEvent.click(screen.getByTestId('onboarding-test-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-test-result')).toHaveTextContent('Connection refused')
    })
  })

  it('shows Next button to proceed to Step 3', async () => {
    await renderStep2()
    expect(screen.getByTestId('onboarding-step2-next-btn')).toBeInTheDocument()
  })

  it('clicking Step 2 Next saves config and advances to Step 3', async () => {
    const fetchSpy = mockFetch()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-next-btn')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('onboarding-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step2'))
    fireEvent.click(screen.getByTestId('onboarding-step2-next-btn'))
    await waitFor(() => {
      // Should have called PUT /config
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/config'),
        expect.objectContaining({ method: 'PUT' })
      )
    })
    expect(screen.getByTestId('onboarding-step3')).toBeInTheDocument()
  })
})
