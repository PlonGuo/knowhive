// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import StatusBar from '../../src/components/layout/StatusBar'

function renderStatusBar(overrides: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  const defaults = {
    health: { status: 'ok', version: '0.1.0' },
    error: null,
    backendUrl: 'http://127.0.0.1:18200',
  }
  return render(<StatusBar {...defaults} {...overrides} />)
}

describe('StatusBar watcher indicator', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('fetches watcher status on mount and displays "Watching" when running', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, syncing: false }),
    } as Response)

    renderStatusBar()

    await waitFor(() => {
      expect(screen.getByTestId('watcher-indicator')).toHaveTextContent('Watching')
    })
  })

  it('displays "Watcher off" when not running', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: false, syncing: false }),
    } as Response)

    renderStatusBar()

    await waitFor(() => {
      expect(screen.getByTestId('watcher-indicator')).toHaveTextContent('Watcher off')
    })
  })

  it('displays "Syncing…" when syncing is true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, syncing: true }),
    } as Response)

    renderStatusBar()

    await waitFor(() => {
      expect(screen.getByTestId('watcher-indicator')).toHaveTextContent('Syncing')
    })
  })

  it('calls GET /watcher/status with correct URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, syncing: false }),
    } as Response)

    renderStatusBar({ backendUrl: 'http://localhost:9999' })

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:9999/watcher/status')
    })
  })

  it('does not show watcher indicator when backendUrl is not provided', () => {
    renderStatusBar({ backendUrl: undefined })
    expect(screen.queryByTestId('watcher-indicator')).not.toBeInTheDocument()
  })

  it('does not show watcher indicator when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'))

    renderStatusBar()

    // Wait for the failed fetch to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.queryByTestId('watcher-indicator')).not.toBeInTheDocument()
  })

  it('clicking the indicator toggles watcher off', async () => {
    let isRunning = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const method = init?.method ?? 'GET'

      if (url.includes('/watcher/toggle') && method === 'POST') {
        const body = JSON.parse(init?.body as string)
        isRunning = body.enabled
        return { ok: true, json: () => Promise.resolve({ running: isRunning, syncing: false }) } as Response
      }
      return { ok: true, json: () => Promise.resolve({ running: isRunning, syncing: false }) } as Response
    })

    renderStatusBar()

    await waitFor(() => {
      expect(screen.getByTestId('watcher-indicator')).toHaveTextContent('Watching')
    })

    fireEvent.click(screen.getByTestId('watcher-indicator'))

    await waitFor(() => {
      expect(screen.getByTestId('watcher-indicator')).toHaveTextContent('Watcher off')
    })
  })

  it('clicking the indicator toggles watcher on when off', async () => {
    let isRunning = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const method = init?.method ?? 'GET'

      if (url.includes('/watcher/toggle') && method === 'POST') {
        const body = JSON.parse(init?.body as string)
        isRunning = body.enabled
        return { ok: true, json: () => Promise.resolve({ running: isRunning, syncing: false }) } as Response
      }
      return { ok: true, json: () => Promise.resolve({ running: isRunning, syncing: false }) } as Response
    })

    renderStatusBar()

    await waitFor(() => {
      expect(screen.getByTestId('watcher-indicator')).toHaveTextContent('Watcher off')
    })

    fireEvent.click(screen.getByTestId('watcher-indicator'))

    await waitFor(() => {
      expect(screen.getByTestId('watcher-indicator')).toHaveTextContent('Watching')
    })
  })

  it('polls watcher status periodically', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, syncing: false }),
    } as Response)

    renderStatusBar()

    // Wait for initial fetch
    await vi.advanceTimersByTimeAsync(50)

    const initialCalls = fetchSpy.mock.calls.filter(c => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url
      return url.includes('/watcher/status')
    }).length

    expect(initialCalls).toBe(1)

    // Advance past polling interval
    await vi.advanceTimersByTimeAsync(10_000)

    const afterPollCalls = fetchSpy.mock.calls.filter(c => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url
      return url.includes('/watcher/status')
    }).length

    expect(afterPollCalls).toBeGreaterThanOrEqual(2)

    vi.useRealTimers()
  })
})
