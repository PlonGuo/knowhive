// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import OnboardingPage from '../../src/components/onboarding/OnboardingPage'

const BACKEND_URL = 'http://127.0.0.1:18200'

function mockFetch(testLlm = true) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = (init as RequestInit | undefined)?.method ?? 'GET'
    if (url.includes('/setup/status')) {
      return { ok: true, json: () => Promise.resolve({ python_ok: true, uv_ok: true, ollama_ok: true, first_run: true }) } as Response
    }
    if (url.includes('/config/test-llm')) {
      return { ok: true, json: () => Promise.resolve({ success: testLlm, message: 'Connected', error: testLlm ? undefined : 'Failed' }) } as Response
    }
    if (url.includes('/setup/complete') && method === 'POST') {
      return { ok: true, json: () => Promise.resolve({ ok: true }) } as Response
    }
    if (url.includes('/config')) {
      return { ok: true, json: () => Promise.resolve({ llm_provider: 'ollama', model_name: 'llama3', base_url: 'http://localhost:11434', api_key: null, embedding_language: 'english' }) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
}

async function navigateToStep3() {
  mockFetch()
  render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
  await waitFor(() => expect(screen.getByTestId('onboarding-next-btn')).not.toBeDisabled())
  fireEvent.click(screen.getByTestId('onboarding-next-btn'))
  await waitFor(() => screen.getByTestId('onboarding-step2'))
  fireEvent.click(screen.getByTestId('onboarding-step2-next-btn'))
  await waitFor(() => screen.getByTestId('onboarding-step3'))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OnboardingPage — Step 3 (ready)', () => {
  it('shows step 3 container after navigating from step 2', async () => {
    await navigateToStep3()
    expect(screen.getByTestId('onboarding-step3')).toBeInTheDocument()
  })

  it('shows a ready/get started message', async () => {
    await navigateToStep3()
    const step3 = screen.getByTestId('onboarding-step3')
    expect(step3.textContent?.toLowerCase()).toMatch(/ready|all set|get started/)
  })

  it('shows Get Started button', async () => {
    await navigateToStep3()
    expect(screen.getByTestId('onboarding-finish-btn')).toBeInTheDocument()
  })

  it('clicking Get Started calls POST /setup/complete', async () => {
    const fetchSpy = mockFetch()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('onboarding-next-btn')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('onboarding-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step2'))
    fireEvent.click(screen.getByTestId('onboarding-step2-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step3'))
    fireEvent.click(screen.getByTestId('onboarding-finish-btn'))
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/setup/complete'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('clicking Get Started calls onComplete callback', async () => {
    mockFetch()
    const onComplete = vi.fn()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={onComplete} />)
    await waitFor(() => expect(screen.getByTestId('onboarding-next-btn')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('onboarding-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step2'))
    fireEvent.click(screen.getByTestId('onboarding-step2-next-btn'))
    await waitFor(() => screen.getByTestId('onboarding-step3'))
    fireEvent.click(screen.getByTestId('onboarding-finish-btn'))
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
  })

  it('shows setup summary (dep status + provider info)', async () => {
    await navigateToStep3()
    const step3 = screen.getByTestId('onboarding-step3')
    // Should show some summary of what was configured
    expect(step3).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-summary')).toBeInTheDocument()
  })
})
