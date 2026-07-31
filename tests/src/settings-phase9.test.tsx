// @vitest-environment happy-dom
// Settings slimming: research knobs (pre-retrieval strategy, chat memory turns,
// reranker on/off, agent mode) are no longer user-facing. Their config fields
// survive as pass-through so config.yaml power users keep working; the reranker
// becomes a single "download → auto-enable" affordance.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SettingsPage from '../../src/components/settings/SettingsPage'

const BACKEND = 'http://localhost:18234'

const fullConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3.2',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
  pre_retrieval_strategy: 'multi_query',
  use_reranker: false,
  chat_mode: 'single',
  chat_permission_mode: 'ask',
  chat_memory_turns: 6,
  custom_system_prompt: '',
}

const rerankerStatus = {
  available: true,
  model: 'bge-reranker-v2-m3',
  size_mb: 568,
  downloaded: false,
  loaded: false,
}

function mockFetch(opts?: { config?: object; reranker?: object; downloadStatus?: object }) {
  const state = { puts: [] as any[], downloadPosted: false }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/reranker/download-status')) {
      return {
        ok: true,
        json: () => Promise.resolve(opts?.downloadStatus ?? { status: null }),
      } as Response
    }
    if (url.includes('/reranker/download')) {
      state.downloadPosted = true
      return { ok: true, json: () => Promise.resolve({}) } as Response
    }
    if (url.includes('/reranker/status')) {
      return { ok: true, json: () => Promise.resolve(opts?.reranker ?? rerankerStatus) } as Response
    }
    if (url.includes('/config')) {
      if (init?.method === 'PUT') state.puts.push(JSON.parse(init.body as string))
      return { ok: true, json: () => Promise.resolve(opts?.config ?? fullConfig) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
  return state
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Settings slimming — auto-routed knobs are hidden', () => {
  it('no longer renders the pre-retrieval strategy dropdown', async () => {
    mockFetch()
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('settings-page'))
    expect(screen.queryByTestId('pre-retrieval-strategy-select')).toBeNull()
  })

  it('no longer renders the chat memory turns input', async () => {
    mockFetch()
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('settings-page'))
    expect(screen.queryByTestId('chat-memory-turns-input')).toBeNull()
  })

  it('no longer renders the reranker on/off toggle', async () => {
    mockFetch()
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('settings-page'))
    expect(screen.queryByTestId('reranker-toggle')).toBeNull()
  })

  it('no longer renders the agent mode toggle (lives in the chat composer now)', async () => {
    mockFetch()
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('settings-page'))
    expect(screen.queryByTestId('chat-mode-toggle')).toBeNull()
  })

  it('still renders custom instructions', async () => {
    mockFetch()
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.getAllByTestId('custom-system-prompt-input').length).toBeGreaterThan(0)
    })
  })

  it('save passes hidden fields through unchanged', async () => {
    const state = mockFetch()
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('save-button'))
    fireEvent.click(screen.getByTestId('save-button'))
    await waitFor(() => {
      const put = state.puts.at(-1)
      expect(put.pre_retrieval_strategy).toBe('multi_query')
      expect(put.chat_memory_turns).toBe(6)
      expect(put.chat_mode).toBe('single')
    })
  })
})

describe('Settings slimming — reranker is download-to-enable', () => {
  it('shows the reranker model section without any toggle', async () => {
    mockFetch()
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.getByTestId('reranker-model-section')).toBeInTheDocument()
      expect(screen.getByTestId('download-reranker-button')).toBeInTheDocument()
    })
  })

  it('shows ready indicator when the model is downloaded', async () => {
    mockFetch({
      config: { ...fullConfig, use_reranker: true },
      reranker: { ...rerankerStatus, downloaded: true },
    })
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.getByTestId('reranker-ready-indicator')).toBeInTheDocument()
    })
  })

  it('auto-enables use_reranker once the download completes', async () => {
    const state = mockFetch({ downloadStatus: { status: 'complete' } })
    render(<SettingsPage backendUrl={BACKEND} />)
    const btn = await waitFor(() => screen.getByTestId('download-reranker-button'))
    fireEvent.click(btn)
    await waitFor(() => {
      expect(state.puts.some((p) => p.use_reranker === true)).toBe(true)
    })
    expect(state.downloadPosted).toBe(true)
  })
})
