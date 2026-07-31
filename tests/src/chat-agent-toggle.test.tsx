// @vitest-environment happy-dom
// Agent mode is a per-conversation choice, so its toggle lives in the chat
// composer (ChatGPT-tools style), not in Settings. Toggling persists chat_mode
// immediately via PUT /config — no Save button involved.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ChatArea from '../../src/components/layout/ChatArea'

const BACKEND = 'http://localhost:18234'

const fullConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3.2',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
  pre_retrieval_strategy: 'none',
  use_reranker: false,
  chat_mode: 'single',
  chat_permission_mode: 'ask',
  chat_memory_turns: 6,
  custom_system_prompt: '',
}

function mockFetch(config: object = fullConfig) {
  const state = { puts: [] as any[] }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/config')) {
      if (init?.method === 'PUT') state.puts.push(JSON.parse(init.body as string))
      return { ok: true, json: () => Promise.resolve(config) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
  return state
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Chat composer — agent mode toggle', () => {
  it('renders the toggle, off when chat_mode is single', async () => {
    mockFetch()
    render(<ChatArea backendUrl={BACKEND} />)
    const toggle = await waitFor(() => screen.getByTestId('chat-agent-toggle'))
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('reflects agentic mode from config', async () => {
    mockFetch({ ...fullConfig, chat_mode: 'agentic' })
    render(<ChatArea backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.getByTestId('chat-agent-toggle')).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('toggling persists chat_mode via PUT /config immediately', async () => {
    const state = mockFetch()
    render(<ChatArea backendUrl={BACKEND} />)
    const toggle = await waitFor(() => screen.getByTestId('chat-agent-toggle'))
    fireEvent.click(toggle)
    await waitFor(() => {
      const put = state.puts.at(-1)
      expect(put?.chat_mode).toBe('agentic')
    })
    expect(screen.getByTestId('chat-agent-toggle')).toHaveAttribute('aria-pressed', 'true')
  })
})
