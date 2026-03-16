// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import SettingsPage from '../../src/components/settings/SettingsPage'

const BACKEND = 'http://localhost:18234'

const fullConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
  pre_retrieval_strategy: 'none',
  use_reranker: false,
  chat_memory_turns: 0,
  custom_system_prompt: '',
}

const rerankerStatus = {
  model: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
  size_mb: 80,
  downloaded: false,
  loaded: false,
}

function mockFetch(configOverride?: object, rerankerOverride?: object) {
  return vi.fn((url: string) => {
    if (url.includes('/config')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(configOverride ?? fullConfig) })
    }
    if (url.includes('/embedding/models')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    }
    if (url.includes('/reranker/status')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(rerankerOverride ?? rerankerStatus) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Phase 9 Settings', () => {
  it('renders pre-retrieval strategy dropdown', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const elems = screen.getAllByTestId('pre-retrieval-strategy-select')
      expect(elems.length).toBeGreaterThan(0)
    })
  })

  it('shows all five strategy options including Auto variants', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const select = screen.getAllByTestId('pre-retrieval-strategy-select')[0] as HTMLSelectElement
      const options = Array.from(select.options).map(o => o.value)
      expect(options).toContain('none')
      expect(options).toContain('hyde')
      expect(options).toContain('multi_query')
      expect(options).toContain('auto')
      expect(options).toContain('auto_llm')
    })
  })

  it('loads pre_retrieval_strategy from config', async () => {
    vi.stubGlobal('fetch', mockFetch({ ...fullConfig, pre_retrieval_strategy: 'hyde' }))
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const select = screen.getAllByTestId('pre-retrieval-strategy-select')[0] as HTMLSelectElement
      expect(select.value).toBe('hyde')
    })
  })

  it('changes pre-retrieval strategy on select', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const select = screen.getAllByTestId('pre-retrieval-strategy-select')[0] as HTMLSelectElement
      fireEvent.change(select, { target: { value: 'multi_query' } })
      expect(select.value).toBe('multi_query')
    })
  })

  it('renders reranker toggle', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const elems = screen.getAllByTestId('reranker-toggle')
      expect(elems.length).toBeGreaterThan(0)
    })
  })

  it('reranker toggle switches on/off', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const toggle = screen.getAllByTestId('reranker-toggle')[0]
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-checked')).toBe('false')
    })
  })

  it('shows reranker model section when toggle is on', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.queryByTestId('reranker-model-section')).toBeNull()
    })
    const toggle = screen.getAllByTestId('reranker-toggle')[0]
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(screen.queryAllByTestId('reranker-model-section').length).toBeGreaterThan(0)
    })
  })

  it('shows download button when reranker not downloaded', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    const toggle = await waitFor(() => screen.getAllByTestId('reranker-toggle')[0])
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(screen.queryAllByTestId('download-reranker-button').length).toBeGreaterThan(0)
    })
  })

  it('shows ready indicator when reranker downloaded', async () => {
    vi.stubGlobal('fetch', mockFetch(
      { ...fullConfig, use_reranker: true },
      { ...rerankerStatus, downloaded: true },
    ))
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.queryAllByTestId('reranker-ready-indicator').length).toBeGreaterThan(0)
    })
  })

  it('renders chat memory turns input', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const elems = screen.getAllByTestId('chat-memory-turns-input')
      expect(elems.length).toBeGreaterThan(0)
    })
  })

  it('loads chat_memory_turns from config', async () => {
    vi.stubGlobal('fetch', mockFetch({ ...fullConfig, chat_memory_turns: 5 }))
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const input = screen.getAllByTestId('chat-memory-turns-input')[0] as HTMLInputElement
      expect(input.value).toBe('5')
    })
  })

  it('changes chat memory turns on input', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const input = screen.getAllByTestId('chat-memory-turns-input')[0] as HTMLInputElement
      fireEvent.change(input, { target: { value: '10' } })
      expect(input.value).toBe('10')
    })
  })

  it('loads auto strategy from config', async () => {
    vi.stubGlobal('fetch', mockFetch({ ...fullConfig, pre_retrieval_strategy: 'auto' }))
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const select = screen.getAllByTestId('pre-retrieval-strategy-select')[0] as HTMLSelectElement
      expect(select.value).toBe('auto')
    })
  })

  it('loads auto_llm strategy from config', async () => {
    vi.stubGlobal('fetch', mockFetch({ ...fullConfig, pre_retrieval_strategy: 'auto_llm' }))
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const select = screen.getAllByTestId('pre-retrieval-strategy-select')[0] as HTMLSelectElement
      expect(select.value).toBe('auto_llm')
    })
  })

  it('can switch to auto strategy', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const select = screen.getAllByTestId('pre-retrieval-strategy-select')[0] as HTMLSelectElement
      fireEvent.change(select, { target: { value: 'auto' } })
      expect(select.value).toBe('auto')
    })
  })

  it('auto options include trade-off descriptions', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const select = screen.getAllByTestId('pre-retrieval-strategy-select')[0] as HTMLSelectElement
      const autoOption = Array.from(select.options).find(o => o.value === 'auto')
      const autoLlmOption = Array.from(select.options).find(o => o.value === 'auto_llm')
      expect(autoOption?.text).toContain('rule-based')
      expect(autoOption?.text).toContain('fast')
      expect(autoLlmOption?.text).toContain('LLM')
      expect(autoLlmOption?.text).toContain('slower')
    })
  })

  it('saves auto_llm strategy to config', async () => {
    const fetchSpy = vi.fn((url: string, options?: any) => {
      if (url.includes('/config') && options?.method === 'PUT') {
        const body = JSON.parse(options.body)
        expect(body.pre_retrieval_strategy).toBe('auto_llm')
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      if (url.includes('/config')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(fullConfig) })
      }
      if (url.includes('/embedding/models')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if (url.includes('/reranker/status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(rerankerStatus) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchSpy)
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const select = screen.getAllByTestId('pre-retrieval-strategy-select')[0] as HTMLSelectElement
      fireEvent.change(select, { target: { value: 'auto_llm' } })
    })
    const saveBtn = await waitFor(() => screen.getAllByTestId('save-button')[0])
    fireEvent.click(saveBtn)
    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        ([url, opts]: any[]) => url.includes('/config') && opts?.method === 'PUT'
      )
      expect(putCalls.length).toBeGreaterThan(0)
    })
  })

  it('renders custom instructions textarea', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const elems = screen.getAllByTestId('custom-system-prompt-input')
      expect(elems.length).toBeGreaterThan(0)
    })
  })

  it('loads custom_system_prompt from config', async () => {
    vi.stubGlobal('fetch', mockFetch({ ...fullConfig, custom_system_prompt: 'Be concise.' }))
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const textarea = screen.getAllByTestId('custom-system-prompt-input')[0] as HTMLTextAreaElement
      expect(textarea.value).toBe('Be concise.')
    })
  })

  it('changes custom instructions on input', async () => {
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const textarea = screen.getAllByTestId('custom-system-prompt-input')[0] as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: 'Respond in Spanish.' } })
      expect(textarea.value).toBe('Respond in Spanish.')
    })
  })

  it('saves custom_system_prompt in config', async () => {
    const fetchSpy = vi.fn((url: string, options?: any) => {
      if (url.includes('/config') && options?.method === 'PUT') {
        const body = JSON.parse(options.body)
        expect(body.custom_system_prompt).toBe('My custom prompt')
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      if (url.includes('/config')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(fullConfig) })
      }
      if (url.includes('/embedding/models')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if (url.includes('/reranker/status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(rerankerStatus) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchSpy)
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      const textarea = screen.getAllByTestId('custom-system-prompt-input')[0] as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: 'My custom prompt' } })
    })
    const saveBtn = await waitFor(() => screen.getAllByTestId('save-button')[0])
    fireEvent.click(saveBtn)
    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        ([url, opts]: any[]) => url.includes('/config') && opts?.method === 'PUT'
      )
      expect(putCalls.length).toBeGreaterThan(0)
    })
  })

  it('saves phase 9 config fields', async () => {
    const fetchSpy = vi.fn((url: string, options?: any) => {
      if (url.includes('/config') && options?.method === 'PUT') {
        const body = JSON.parse(options.body)
        expect(body.pre_retrieval_strategy).toBeDefined()
        expect(body.use_reranker).toBeDefined()
        expect(body.chat_memory_turns).toBeDefined()
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      if (url.includes('/config')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(fullConfig) })
      }
      if (url.includes('/embedding/models')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if (url.includes('/reranker/status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(rerankerStatus) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchSpy)
    render(<SettingsPage backendUrl={BACKEND} />)
    const saveBtn = await waitFor(() => screen.getAllByTestId('save-button')[0])
    fireEvent.click(saveBtn)
    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        ([url, opts]: any[]) => url.includes('/config') && opts?.method === 'PUT'
      )
      expect(putCalls.length).toBeGreaterThan(0)
    })
  })
})
