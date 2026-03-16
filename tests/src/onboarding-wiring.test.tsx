// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from '../../src/App'

const BACKEND_URL = 'http://127.0.0.1:18200'

function mockApi() {
  Object.defineProperty(window, 'api', {
    value: {
      getBackendUrl: vi.fn().mockResolvedValue(BACKEND_URL),
      getSidecarStatus: vi.fn().mockResolvedValue('running'),
    },
    writable: true,
    configurable: true,
  })
}

function mockFetch(firstRun: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/setup/status')) {
      return { ok: true, json: () => Promise.resolve({ python_ok: true, uv_ok: true, ollama_ok: true, first_run: firstRun }) } as Response
    }
    if (url.includes('/setup/complete')) {
      return { ok: true, json: () => Promise.resolve({ ok: true }) } as Response
    }
    if (url.includes('/health')) {
      return { ok: true, json: () => Promise.resolve({ status: 'ok', version: '0.1.0' }) } as Response
    }
    if (url.includes('/config/test-llm')) {
      return { ok: true, json: () => Promise.resolve({ success: true, message: 'Connected' }) } as Response
    }
    if (url.includes('/config')) {
      return { ok: true, json: () => Promise.resolve({ llm_provider: 'ollama', model_name: 'llama3', base_url: 'http://localhost:11434', api_key: null, embedding_language: 'english' }) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
}

beforeEach(() => { mockApi() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Onboarding wiring — App.tsx', () => {
  it('shows OnboardingPage when first_run is true', async () => {
    mockFetch(true)
    render(<App />)
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-page')).toBeInTheDocument()
    })
  })

  it('does not show OnboardingPage when first_run is false', async () => {
    mockFetch(false)
    render(<App />)
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument()
    })
  })

  it('shows AppLayout when first_run is false', async () => {
    mockFetch(false)
    render(<App />)
    await waitFor(() => {
      expect(screen.getByTestId('app-layout')).toBeInTheDocument()
    })
  })

  it('shows AppLayout after onboarding completes', async () => {
    mockFetch(true)
    render(<App />)
    // Navigate through all onboarding steps
    await waitFor(() => expect(screen.getByTestId('onboarding-next-btn')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('onboarding-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step2'))
    fireEvent.click(screen.getByTestId('onboarding-step2-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step3'))
    fireEvent.click(screen.getByTestId('onboarding-finish-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('app-layout')).toBeInTheDocument()
    })
  })

  it('hides OnboardingPage after completion', async () => {
    mockFetch(true)
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('onboarding-next-btn')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('onboarding-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step2'))
    fireEvent.click(screen.getByTestId('onboarding-step2-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step3'))
    fireEvent.click(screen.getByTestId('onboarding-finish-btn'))
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument()
      expect(screen.queryByTestId('onboarding-step3')).not.toBeInTheDocument()
    })
  })
})
