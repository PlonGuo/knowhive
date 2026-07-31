// @vitest-environment happy-dom
// Sidebar usage meter (Codex-style): cloud providers show cumulative session
// token spend; Ollama shows how full the local model's context window is
// (last prompt tokens / model context_length).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import UsageBadge from '../../src/components/layout/UsageBadge'

const BACKEND = 'http://localhost:18234'

function mockFetch(opts: { provider: string; contextLength?: number | null }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/ollama/context')) {
      return {
        ok: true,
        json: () => Promise.resolve({ model: 'llama3.2', context_length: opts.contextLength ?? null }),
      } as Response
    }
    if (url.includes('/config')) {
      return { ok: true, json: () => Promise.resolve({ llm_provider: opts.provider }) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('UsageBadge', () => {
  it('renders nothing before any usage arrives', async () => {
    mockFetch({ provider: 'ollama', contextLength: 8192 })
    render(<UsageBadge backendUrl={BACKEND} usage={null} />)
    expect(screen.queryByTestId('usage-badge')).toBeNull()
  })

  it('cloud provider: shows cumulative session tokens', async () => {
    mockFetch({ provider: 'openai-compatible' })
    render(
      <UsageBadge backendUrl={BACKEND} usage={{ sessionTokens: 12345, lastInputTokens: 1200 }} />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('usage-badge')).toHaveTextContent('12.3k tokens')
    })
  })

  it('ollama: shows context fill percentage from last prompt size', async () => {
    mockFetch({ provider: 'ollama', contextLength: 8192 })
    render(
      <UsageBadge backendUrl={BACKEND} usage={{ sessionTokens: 5000, lastInputTokens: 4096 }} />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('usage-badge')).toHaveTextContent('50%')
    })
  })

  it('ollama without a known context length falls back to token count', async () => {
    mockFetch({ provider: 'ollama', contextLength: null })
    render(
      <UsageBadge backendUrl={BACKEND} usage={{ sessionTokens: 800, lastInputTokens: 500 }} />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('usage-badge')).toHaveTextContent('800 tokens')
    })
  })
})
