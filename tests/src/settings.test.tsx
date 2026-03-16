// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SettingsPage from '../../src/components/settings/SettingsPage'

const mockBackendUrl = 'http://127.0.0.1:18200'

function mockFetchResponses(responses: Record<string, unknown>) {
  // Sort patterns longest-first so /config/test-llm matches before /config
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

const defaultConfig = {
  llm_provider: 'ollama',
  model_name: 'llama3',
  base_url: 'http://localhost:11434',
  api_key: null,
  embedding_language: 'english',
}

describe('SettingsPage', () => {
  beforeEach(() => {
    mockFetchResponses({ '/config': defaultConfig })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders settings form with title', async () => {
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('loads and displays current config on mount', async () => {
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
      expect(screen.getByDisplayValue('http://localhost:11434')).toBeInTheDocument()
    })
  })

  it('shows LLM provider selector with ollama and openai-compatible options', async () => {
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      const select = screen.getByTestId('llm-provider-select') as HTMLSelectElement
      expect(select).toBeInTheDocument()
      expect(select.value).toBe('ollama')
    })
  })

  it('shows embedding language selector', async () => {
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      const select = screen.getByTestId('embedding-language-select') as HTMLSelectElement
      expect(select).toBeInTheDocument()
      expect(select.value).toBe('english')
    })
  })

  it('hides API key field when provider is ollama', async () => {
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('api-key-input')).not.toBeInTheDocument()
  })

  it('shows API key field when provider is openai-compatible', async () => {
    mockFetchResponses({
      '/config': { ...defaultConfig, llm_provider: 'openai-compatible', api_key: 'sk-test' },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      const input = screen.getByTestId('api-key-input') as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.value).toBe('sk-test')
    })
  })

  it('shows API key field after switching provider to openai-compatible', async () => {
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('llm-provider-select'), {
      target: { value: 'openai-compatible' },
    })
    expect(screen.getByTestId('api-key-input')).toBeInTheDocument()
  })

  it('calls PUT /config when save is clicked', async () => {
    const fetchSpy = mockFetchResponses({ '/config': defaultConfig })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('model-name-input'), {
      target: { value: 'mistral' },
    })
    fireEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      const putCall = fetchSpy.mock.calls.find(
        (c) => typeof c[1] === 'object' && (c[1] as RequestInit).method === 'PUT'
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse((putCall![1] as RequestInit).body as string)
      expect(body.model_name).toBe('mistral')
    })
  })

  it('calls POST /config/test-llm when test connection is clicked', async () => {
    const fetchSpy = mockFetchResponses({
      '/config': defaultConfig,
      '/config/test-llm': { success: true, message: 'LLM connection successful' },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('test-connection-button'))

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('test-llm')
      )
      expect(postCall).toBeDefined()
    })
  })

  it('displays test connection success message', async () => {
    mockFetchResponses({
      '/config': defaultConfig,
      '/config/test-llm': { success: true, message: 'LLM connection successful' },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('test-connection-button'))

    await waitFor(() => {
      expect(screen.getByText('LLM connection successful')).toBeInTheDocument()
    })
  })

  it('displays test connection error message', async () => {
    mockFetchResponses({
      '/config': defaultConfig,
      '/config/test-llm': { success: false, error: 'Connection failed: refused' },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('test-connection-button'))

    await waitFor(() => {
      expect(screen.getByText('Connection failed: refused')).toBeInTheDocument()
    })
  })

  it('shows anthropic option in LLM provider selector', async () => {
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      const select = screen.getByTestId('llm-provider-select')
      const options = select.querySelectorAll('option')
      const values = Array.from(options).map((o) => o.value)
      expect(values).toContain('anthropic')
    })
  })

  it('shows API key field when provider is anthropic', async () => {
    mockFetchResponses({
      '/config': { ...defaultConfig, llm_provider: 'anthropic', api_key: 'sk-ant-test', base_url: 'https://api.anthropic.com' },
    })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      const input = screen.getByTestId('api-key-input') as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.value).toBe('sk-ant-test')
    })
  })

  it('shows API key field after switching provider to anthropic', async () => {
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('llm-provider-select'), {
      target: { value: 'anthropic' },
    })
    expect(screen.getByTestId('api-key-input')).toBeInTheDocument()
  })

  it('displays Anthropic Claude label for anthropic option', async () => {
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      const select = screen.getByTestId('llm-provider-select')
      const options = select.querySelectorAll('option')
      const anthropicOption = Array.from(options).find((o) => o.value === 'anthropic')
      expect(anthropicOption).toBeDefined()
      expect(anthropicOption!.textContent).toBe('Anthropic Claude')
    })
  })

  it('has a back button that calls onBack', async () => {
    const onBack = vi.fn()
    render(<SettingsPage backendUrl={mockBackendUrl} onBack={onBack} />)
    fireEvent.click(screen.getByTestId('settings-back-button'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('shows save success feedback', async () => {
    mockFetchResponses({ '/config': defaultConfig })
    render(<SettingsPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByText('Settings saved')).toBeInTheDocument()
    })
  })

  it('calls onConfigSaved after successful save', async () => {
    const onConfigSaved = vi.fn()
    mockFetchResponses({ '/config': defaultConfig })
    render(<SettingsPage backendUrl={mockBackendUrl} onConfigSaved={onConfigSaved} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(onConfigSaved).toHaveBeenCalledOnce()
    })
  })

  it('does not call onConfigSaved when save fails', async () => {
    const onConfigSaved = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'PUT') {
        throw new Error('network error')
      }
      return { ok: true, json: () => Promise.resolve(defaultConfig) } as Response
    })
    render(<SettingsPage backendUrl={mockBackendUrl} onConfigSaved={onConfigSaved} />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('llama3')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByText('Failed to save settings')).toBeInTheDocument()
    })
    expect(onConfigSaved).not.toHaveBeenCalled()
  })
})
