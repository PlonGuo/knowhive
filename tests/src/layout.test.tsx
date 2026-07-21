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
      '/chat/history': { messages: [], total: 0 },
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

  it('renders the shell (drag strip, sidebar, chat)', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByTestId('drag-strip')).toBeInTheDocument()
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('chat-area')).toBeInTheDocument()
    })
  })

  it('sidebar has a collapse handle (title row removed by design)', async () => {
    render(<App />)
    expect(await screen.findByTestId('sidebar-collapse')).toBeInTheDocument()
  })

  it('sidebar has a placeholder for file tree', async () => {
    render(<App />)
    expect(await screen.findByTestId('sidebar')).toHaveTextContent('Knowledge')
  })

  it('chat area shows a placeholder message', async () => {
    render(<App />)
    expect(await screen.findByTestId('chat-area')).toHaveTextContent('Start a conversation')
  })

  it('sidebar footer hosts the theme toggle (status bar removed by design)', async () => {
    render(<App />)
    expect(await screen.findByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('shows a connecting placeholder while the setup check is pending', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<App />)
    expect(screen.getByTestId('app-connecting')).toHaveTextContent('Connecting')
  })

  it('renders the layout even when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'))
    render(<App />)
    expect(await screen.findByTestId('app-layout')).toBeInTheDocument()
  })

  it('sidebar has a settings button', async () => {
    render(<App />)
    expect(await screen.findByTestId('settings-button')).toBeInTheDocument()
  })

  it('layout fills the full viewport', async () => {
    render(<App />)
    expect(await screen.findByTestId('app-layout')).toHaveClass('h-screen')
  })
})
