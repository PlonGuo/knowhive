// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import OnboardingPage from '../../src/components/onboarding/OnboardingPage'

const BACKEND_URL = 'http://127.0.0.1:18200'

function mockSetupStatus(overrides: Record<string, unknown> = {}) {
  const defaults = { python_ok: true, uv_ok: true, ollama_ok: true, first_run: true }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/setup/status')) {
      return { ok: true, json: () => Promise.resolve({ ...defaults, ...overrides }) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OnboardingPage — Step 1 (dependency check)', () => {
  it('renders the onboarding page container', () => {
    mockSetupStatus()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    expect(screen.getByTestId('onboarding-page')).toBeInTheDocument()
  })

  it('shows dep-python, dep-uv, dep-ollama rows', () => {
    mockSetupStatus()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    expect(screen.getByTestId('dep-python')).toBeInTheDocument()
    expect(screen.getByTestId('dep-uv')).toBeInTheDocument()
    expect(screen.getByTestId('dep-ollama')).toBeInTheDocument()
  })

  it('shows Next button', () => {
    mockSetupStatus()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    expect(screen.getByTestId('onboarding-next-btn')).toBeInTheDocument()
  })

  it('fetches /setup/status on mount', async () => {
    mockSetupStatus()
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/setup/status')
      )
    })
  })

  it('Next button is disabled when uv_ok is false', async () => {
    mockSetupStatus({ uv_ok: false })
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    await waitFor(() => {
      const btn = screen.getByTestId('onboarding-next-btn')
      expect(btn).toBeDisabled()
    })
  })

  it('Next button is enabled when uv_ok is true', async () => {
    mockSetupStatus({ uv_ok: true })
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    await waitFor(() => {
      const btn = screen.getByTestId('onboarding-next-btn')
      expect(btn).not.toBeDisabled()
    })
  })

  it('shows check mark for python_ok=true', async () => {
    mockSetupStatus({ python_ok: true })
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    await waitFor(() => {
      const row = screen.getByTestId('dep-python')
      expect(row.textContent).toContain('✓')
    })
  })

  it('shows cross mark for uv_ok=false', async () => {
    mockSetupStatus({ uv_ok: false })
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    await waitFor(() => {
      const row = screen.getByTestId('dep-uv')
      expect(row.textContent).toContain('✗')
    })
  })

  it('shows install link when uv_ok=false', async () => {
    mockSetupStatus({ uv_ok: false })
    render(<OnboardingPage backendUrl={BACKEND_URL} onComplete={vi.fn()} />)
    await waitFor(() => {
      const row = screen.getByTestId('dep-uv')
      expect(row.querySelector('a')).toBeInTheDocument()
    })
  })
})
