// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from '../../src/App'

describe('AppLayout', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: {
        getBackendUrl: vi.fn().mockResolvedValue('http://127.0.0.1:18200'),
        getSidecarStatus: vi.fn().mockResolvedValue('running'),
        selectFiles: vi.fn().mockResolvedValue([]),
      },
      writable: true,
      configurable: true
    })
    const sorted = Object.entries({
      '/health': { status: 'ok', version: '0.1.0' },
      '/knowledge/tree': { name: 'knowledge', path: '', type: 'directory', children: [] },
    }).sort((a, b) => b[0].length - a[0].length)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      for (const [pattern, data] of sorted) {
        if (url.includes(pattern)) {
          return { ok: true, json: () => Promise.resolve(data) } as Response
        }
      }
      return { ok: true, json: () => Promise.resolve({ status: 'ok', version: '0.1.0' }) } as Response
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the three-panel layout (sidebar, chat, status bar)', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('chat-area')).toBeInTheDocument()
      expect(screen.getByTestId('status-bar')).toBeInTheDocument()
    })
  })

  it('sidebar contains KnowHive branding', async () => {
    render(<App />)
    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toHaveTextContent('KnowHive')
  })

  it('sidebar has a placeholder for file tree', async () => {
    render(<App />)
    expect(screen.getByTestId('sidebar')).toHaveTextContent('Knowledge')
  })

  it('chat area shows a placeholder message', async () => {
    render(<App />)
    expect(screen.getByTestId('chat-area')).toHaveTextContent('Start a conversation')
  })

  it('status bar shows backend connection status', async () => {
    render(<App />)
    await waitFor(() => {
      const statusBar = screen.getByTestId('status-bar')
      expect(statusBar).toHaveTextContent('ok')
      expect(statusBar).toHaveTextContent('v0.1.0')
    })
  })

  it('status bar shows connecting state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<App />)
    const statusBar = screen.getByTestId('status-bar')
    expect(statusBar).toHaveTextContent('Connecting')
  })

  it('status bar shows error when backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'))
    render(<App />)
    await waitFor(() => {
      const statusBar = screen.getByTestId('status-bar')
      expect(statusBar).toHaveTextContent('Disconnected')
    })
  })

  it('sidebar has a settings button', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<App />)
    expect(screen.getByTestId('settings-button')).toBeInTheDocument()
  })

  it('layout fills the full viewport', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<App />)
    const layout = screen.getByTestId('app-layout')
    expect(layout).toHaveClass('h-screen')
  })
})
