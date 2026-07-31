// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SettingsPage from '../../src/components/settings/SettingsPage'

// Settings model management after R3: embedding model status comes from
// /ollama/status and downloads go through the streaming /ollama/pull proxy.

const BACKEND = 'http://localhost:18234'

const fullConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3.2',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
  pre_retrieval_strategy: 'none',
  use_reranker: false,
  chat_memory_turns: 0,
  custom_system_prompt: '',
}

function ndjsonBody(lines: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(line) + '\n'))
      }
      controller.close()
    },
  })
}

function mockBackend(opts: { embeddingInstalled: boolean; rerankerAvailable?: boolean }) {
  const state = { installed: opts.embeddingInstalled, pulled: [] as string[], puts: [] as unknown[] }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/ollama/status')) {
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            running: true,
            models: state.installed ? ['nomic-embed-text:latest'] : [],
            required: [{ name: 'nomic-embed-text', purpose: 'embedding', installed: state.installed }],
          }),
      } as Response
    }
    if (url.includes('/ollama/pull')) {
      state.pulled.push(JSON.parse(init!.body as string).model)
      state.installed = true
      return { ok: true, body: ndjsonBody([{ status: 'success' }]) } as unknown as Response
    }
    if (url.includes('/reranker/status')) {
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            available: opts.rerankerAvailable ?? false,
            model: 'none (planned: Phase E)',
            size_mb: 0,
            downloaded: false,
            loaded: false,
          }),
      } as Response
    }
    if (url.includes('/config')) {
      if (init?.method === 'PUT') state.puts.push(JSON.parse(init.body as string))
      return { ok: true, json: () => Promise.resolve(fullConfig) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
  return state
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Settings — Ollama-backed embedding model', () => {
  it('shows a ready indicator when the embedding model is installed', async () => {
    mockBackend({ embeddingInstalled: true })
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.getByTestId('embedding-model-section')).toHaveTextContent('nomic-embed-text')
      expect(screen.getByTestId('embedding-ready-indicator')).toBeInTheDocument()
    })
  })

  it('pulls the model through /ollama/pull and flips to ready', async () => {
    const state = mockBackend({ embeddingInstalled: false })
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('download-embedding-button'))
    fireEvent.click(screen.getByTestId('download-embedding-button'))
    await waitFor(() => expect(screen.getByTestId('embedding-ready-indicator')).toBeInTheDocument())
    expect(state.pulled).toEqual(['nomic-embed-text'])
  })
})

describe('Settings — reranker stub (Phase E pending)', () => {
  it('shows the unavailable note instead of a download section', async () => {
    mockBackend({ embeddingInstalled: true, rerankerAvailable: false })
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.getByTestId('reranker-unavailable-note')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('reranker-model-section')).not.toBeInTheDocument()
  })
})

describe('Settings — agent mode moved out of settings', () => {
  it('does not render the chat-mode toggle here (it lives in the chat composer)', async () => {
    mockBackend({ embeddingInstalled: true })
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('permission-mode-select'))
    expect(screen.queryByTestId('chat-mode-toggle')).toBeNull()
  })
})

describe('Settings — agent write permissions (Phase H)', () => {
  it('selects a permission mode and saves it', async () => {
    const state = mockBackend({ embeddingInstalled: true })
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('permission-mode-select'))

    fireEvent.change(screen.getByTestId('permission-mode-select'), {
      target: { value: 'accept-edits' },
    })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => {
      const put = state.puts.at(-1) as { chat_permission_mode?: string } | undefined
      expect(put?.chat_permission_mode).toBe('accept-edits')
    })
  })
})
