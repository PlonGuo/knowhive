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

const modelsNotDownloaded = [
  { language: 'english', name: 'all-MiniLM-L6-v2', size_mb: 80, downloaded: false },
  { language: 'chinese', name: 'text2vec-base-chinese', size_mb: 400, downloaded: false },
  { language: 'mixed', name: 'bge-m3', size_mb: 1200, downloaded: false },
]

const modelsEnglishDownloaded = [
  { language: 'english', name: 'all-MiniLM-L6-v2', size_mb: 80, downloaded: true },
  { language: 'chinese', name: 'text2vec-base-chinese', size_mb: 400, downloaded: false },
  { language: 'mixed', name: 'bge-m3', size_mb: 1200, downloaded: false },
]

function mockFetch(responses: Record<string, unknown>) {
  const sorted = Object.entries(responses).sort((a, b) => b[0].length - a[0].length)
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    for (const [pattern, data] of sorted) {
      if (url.includes(pattern)) {
        return { ok: true, json: () => Promise.resolve(data) } as Response
      }
    }
    return { ok: false, json: () => Promise.resolve({}) } as Response
  })
}

describe('SettingsPage — Embedding Download UI', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows embedding model info section', async () => {
    mockFetch({ '/config': defaultConfig, '/embedding/models': modelsNotDownloaded, '/embedding/status': { status: null } })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('embedding-model-section')).toBeInTheDocument()
    })
  })

  it('shows model name for selected embedding language', async () => {
    mockFetch({ '/config': defaultConfig, '/embedding/models': modelsNotDownloaded, '/embedding/status': { status: null } })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText(/all-MiniLM-L6-v2/i)).toBeInTheDocument()
    })
  })

  it('shows Download button when model is not downloaded', async () => {
    mockFetch({ '/config': defaultConfig, '/embedding/models': modelsNotDownloaded, '/embedding/status': { status: null } })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('download-embedding-button')).toBeInTheDocument()
    })
  })

  it('shows Ready indicator when model is downloaded', async () => {
    mockFetch({ '/config': defaultConfig, '/embedding/models': modelsEnglishDownloaded, '/embedding/status': { status: null } })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('embedding-ready-indicator')).toBeInTheDocument()
      expect(screen.queryByTestId('download-embedding-button')).not.toBeInTheDocument()
    })
  })

  it('calls POST /embedding/download when download button is clicked', async () => {
    const fetchSpy = mockFetch({
      '/config': defaultConfig,
      '/embedding/models': modelsNotDownloaded,
      '/embedding/status': { status: null },
      '/embedding/download': { status: 'started', language: 'english' },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('download-embedding-button')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('download-embedding-button'))

    await waitFor(() => {
      const downloadCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('/embedding/download')
      )
      expect(downloadCall).toBeDefined()
    })
  })

  it('shows progress bar while downloading', async () => {
    mockFetch({
      '/config': defaultConfig,
      '/embedding/models': modelsNotDownloaded,
      '/embedding/status': { language: 'english', status: 'downloading', progress: 0.4 },
      '/embedding/download': { status: 'started', language: 'english' },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('download-embedding-button')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('download-embedding-button'))

    await waitFor(() => {
      expect(screen.getByTestId('embedding-progress-bar')).toBeInTheDocument()
    })
  })

  it('shows warning when saving with undownloaded model', async () => {
    mockFetch({
      '/config': defaultConfig,
      '/embedding/models': modelsNotDownloaded,
      '/embedding/status': { status: null },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('embedding-model-section')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('embedding-warning')).toBeInTheDocument()
    })
  })

  it('does not show warning when saving with downloaded model', async () => {
    mockFetch({
      '/config': defaultConfig,
      '/embedding/models': modelsEnglishDownloaded,
      '/embedding/status': { status: null },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('embedding-ready-indicator')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByText('Settings saved')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('embedding-warning')).not.toBeInTheDocument()
  })

  it('shows size in MB next to model name', async () => {
    mockFetch({ '/config': defaultConfig, '/embedding/models': modelsNotDownloaded, '/embedding/status': { status: null } })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText(/80\s*MB/i)).toBeInTheDocument()
    })
  })

  it('updates model info when embedding language changes', async () => {
    mockFetch({
      '/config': defaultConfig,
      '/embedding/models': modelsNotDownloaded,
      '/embedding/status': { status: null },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText(/all-MiniLM-L6-v2/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('embedding-language-select'), {
      target: { value: 'chinese' },
    })

    await waitFor(() => {
      expect(screen.getByText(/text2vec-base-chinese/i)).toBeInTheDocument()
    })
  })
})
