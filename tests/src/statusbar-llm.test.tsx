// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import StatusBar from '../../src/components/layout/StatusBar'

const mockConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
}

const watcherResponse = { running: true, syncing: false }

function mockFetchForConfig(config = mockConfig) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/config')) {
      return { ok: true, json: () => Promise.resolve(config) } as Response
    }
    if (url.includes('/watcher')) {
      return { ok: true, json: () => Promise.resolve(watcherResponse) } as Response
    }
    return { ok: false } as Response
  })
}

function renderStatusBar(overrides: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  const defaults = {
    health: { status: 'ok', version: '0.1.0' },
    error: null,
    backendUrl: 'http://127.0.0.1:18200',
  }
  return render(<StatusBar {...defaults} {...overrides} />)
}

describe('StatusBar LLM display', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('fetches config on mount and displays LLM provider and model', async () => {
    mockFetchForConfig()
    renderStatusBar()

    await waitFor(() => {
      const llmIndicator = screen.getByTestId('llm-indicator')
      expect(llmIndicator).toHaveTextContent('ollama / llama3')
    })
  })

  it('displays anthropic provider and model name', async () => {
    mockFetchForConfig({
      ...mockConfig,
      llm_provider: 'anthropic',
      model_name: 'claude-3-opus',
    })
    renderStatusBar()

    await waitFor(() => {
      const llmIndicator = screen.getByTestId('llm-indicator')
      expect(llmIndicator).toHaveTextContent('anthropic / claude-3-opus')
    })
  })

  it('displays openai-compatible provider', async () => {
    mockFetchForConfig({
      ...mockConfig,
      llm_provider: 'openai-compatible',
      model_name: 'gpt-4',
    })
    renderStatusBar()

    await waitFor(() => {
      expect(screen.getByTestId('llm-indicator')).toHaveTextContent('openai-compatible / gpt-4')
    })
  })

  it('does not show LLM indicator when backendUrl is missing', () => {
    renderStatusBar({ backendUrl: undefined })
    expect(screen.queryByTestId('llm-indicator')).not.toBeInTheDocument()
  })

  it('does not show LLM indicator when config fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    renderStatusBar()

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.queryByTestId('llm-indicator')).not.toBeInTheDocument()
  })

  it('calls GET /config with correct URL', async () => {
    const fetchSpy = mockFetchForConfig()
    renderStatusBar({ backendUrl: 'http://localhost:9999' })

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:9999/config')
    })
  })

  it('refetches config when configVersion changes', async () => {
    const fetchSpy = mockFetchForConfig()
    const { rerender } = render(
      <StatusBar
        health={{ status: 'ok', version: '0.1.0' }}
        error={null}
        backendUrl="http://127.0.0.1:18200"
        configVersion={0}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('llm-indicator')).toHaveTextContent('ollama / llama3')
    })

    const initialConfigCalls = fetchSpy.mock.calls.filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url
      return url.includes('/config') && !url.includes('/test')
    }).length

    // Update with new config on next fetch
    fetchSpy.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/config')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({ ...mockConfig, llm_provider: 'anthropic', model_name: 'claude-3' }),
        } as Response
      }
      if (url.includes('/watcher')) {
        return { ok: true, json: () => Promise.resolve(watcherResponse) } as Response
      }
      return { ok: false } as Response
    })

    rerender(
      <StatusBar
        health={{ status: 'ok', version: '0.1.0' }}
        error={null}
        backendUrl="http://127.0.0.1:18200"
        configVersion={1}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('llm-indicator')).toHaveTextContent('anthropic / claude-3')
    })

    const finalConfigCalls = fetchSpy.mock.calls.filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url
      return url.includes('/config') && !url.includes('/test')
    }).length

    expect(finalConfigCalls).toBeGreaterThan(initialConfigCalls)
  })
})
