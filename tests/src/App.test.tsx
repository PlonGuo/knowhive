// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from '../../src/App'

describe('App', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    // Mock window.api.getBackendUrl
    Object.defineProperty(window, 'api', {
      value: {
        getBackendUrl: vi.fn().mockResolvedValue('http://127.0.0.1:18200'),
        getSidecarStatus: vi.fn().mockResolvedValue('running')
      },
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows connecting state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<App />)
    expect(screen.getByText('Connecting...')).toBeInTheDocument()
  })

  it('displays health status on successful /health call', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ status: 'ok', version: '0.1.0' })
    } as Response)

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Backend: ok v0.1.0')).toBeInTheDocument()
    })

    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:18200/health')
  })

  it('displays error when backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Disconnected')).toBeInTheDocument()
    })
  })

  it('falls back to default URL when window.api is unavailable', async () => {
    // Remove window.api
    Object.defineProperty(window, 'api', {
      value: undefined,
      writable: true,
      configurable: true
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ status: 'ok', version: '0.1.0' })
    } as Response)

    render(<App />)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/health')
    })
  })

  it('renders KnowHive title', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<App />)
    expect(screen.getByText('KnowHive')).toBeInTheDocument()
  })
})
