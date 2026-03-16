// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SettingsPage from '../../src/components/settings/SettingsPage'

const mockBackendUrl = 'http://127.0.0.1:18200'

const defaultConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
}

function mockFetch(responses: Record<string, unknown>) {
  const sorted = Object.entries(responses).sort((a, b) => b[0].length - a[0].length)
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = (init as RequestInit | undefined)?.method ?? 'GET'
    for (const [pattern, data] of sorted) {
      if (url.includes(pattern)) {
        // For binary responses (ZIP), return appropriate mock
        if (pattern === '/export/full') {
          return {
            ok: true,
            blob: () => Promise.resolve(new Blob(['ZIPDATA'], { type: 'application/zip' })),
            json: () => Promise.resolve(data),
          } as Response
        }
        return { ok: true, json: () => Promise.resolve(data) } as Response
      }
    }
    return { ok: false, json: () => Promise.resolve({}) } as Response
  })
}

const defaultResponses = {
  '/config': defaultConfig,
  '/embedding/models': [],
  '/embedding/status': { status: null },
}

describe('SettingsPage — Export UI', () => {
  beforeEach(() => {
    // Mock window.api.saveFile
    Object.defineProperty(window, 'api', {
      value: {
        saveFile: vi.fn().mockResolvedValue('/Users/test/export.zip'),
        selectFiles: vi.fn().mockResolvedValue([]),
      },
      writable: true,
    })
    // Mock URL.createObjectURL and revokeObjectURL
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn().mockReturnValue('blob:test'), writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows Data Management section', async () => {
    mockFetch(defaultResponses)
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('data-management-section')).toBeInTheDocument()
    })
  })

  it('shows Export All button', async () => {
    mockFetch(defaultResponses)
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('export-all-button')).toBeInTheDocument()
    })
  })

  it('shows Export Chat button', async () => {
    mockFetch(defaultResponses)
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('export-chat-button')).toBeInTheDocument()
    })
  })

  it('calls POST /export/full when Export All is clicked', async () => {
    const fetchSpy = mockFetch({
      ...defaultResponses,
      '/export/full': {},
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('export-all-button')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('export-all-button'))

    await waitFor(() => {
      const exportCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('/export/full')
      )
      expect(exportCall).toBeDefined()
    })
  })

  it('calls POST /export/chat when Export Chat is clicked', async () => {
    const fetchSpy = mockFetch({
      ...defaultResponses,
      '/export/chat': [{ role: 'user', content: 'Hi' }],
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('export-chat-button')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('export-chat-button'))

    await waitFor(() => {
      const exportCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('/export/chat')
      )
      expect(exportCall).toBeDefined()
    })
  })

  it('shows export success message after Export All', async () => {
    mockFetch({
      ...defaultResponses,
      '/export/full': {},
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('export-all-button')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('export-all-button'))

    await waitFor(() => {
      expect(screen.getByTestId('export-status')).toBeInTheDocument()
    })
  })

  it('shows export chat success message after Export Chat', async () => {
    mockFetch({
      ...defaultResponses,
      '/export/chat': [],
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('export-chat-button')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('export-chat-button'))

    await waitFor(() => {
      expect(screen.getByTestId('export-status')).toBeInTheDocument()
    })
  })
})
