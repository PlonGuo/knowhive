// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import MarkdownEditor from '../../src/components/knowledge/MarkdownEditor'

const mockBackendUrl = 'http://127.0.0.1:18200'
const mockFilePath = 'notes/hello.md'
const mockFileContent = '# Hello\n\nThis is a test file.'

function mockFetchResponses(responses: Record<string, unknown>, methods?: Record<string, string>) {
  const sorted = Object.entries(responses).sort((a, b) => b[0].length - a[0].length)
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init?) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    for (const [pattern, data] of sorted) {
      if (url.includes(pattern)) {
        return { ok: true, json: () => Promise.resolve(data) } as Response
      }
    }
    return { ok: false, json: () => Promise.resolve({ detail: 'Not found' }) } as Response
  })
}

describe('MarkdownEditor', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders with filename in header', async () => {
    mockFetchResponses({
      '/knowledge/file': { name: 'hello.md', path: mockFilePath, content: mockFileContent },
    })
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    await waitFor(() => {
      expect(screen.getByTestId('editor-filename')).toHaveTextContent('hello.md')
    })
  })

  it('fetches and displays file content on mount', async () => {
    mockFetchResponses({
      '/knowledge/file': { name: 'hello.md', path: mockFilePath, content: mockFileContent },
    })
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    await waitFor(() => {
      const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement
      expect(textarea.value).toBe(mockFileContent)
    })
  })

  it('shows loading state while fetching', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    expect(screen.getByTestId('editor-loading')).toBeInTheDocument()
  })

  it('shows error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ detail: 'File not found' }),
    } as Response)
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    await waitFor(() => {
      expect(screen.getByTestId('editor-error')).toBeInTheDocument()
    })
  })

  it('updates textarea value on change', async () => {
    mockFetchResponses({
      '/knowledge/file': { name: 'hello.md', path: mockFilePath, content: mockFileContent },
    })
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('editor-textarea'), {
      target: { value: '# Updated content' },
    })
    expect((screen.getByTestId('editor-textarea') as HTMLTextAreaElement).value).toBe('# Updated content')
  })

  it('calls PUT /knowledge/file/content on save', async () => {
    const fetchSpy = mockFetchResponses({
      '/knowledge/file': { name: 'hello.md', path: mockFilePath, content: mockFileContent },
    })
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('editor-textarea'), {
      target: { value: '# Saved content' },
    })
    fireEvent.click(screen.getByTestId('editor-save-button'))

    await waitFor(() => {
      const putCall = fetchSpy.mock.calls.find(
        (c) => typeof c[1] === 'object' && (c[1] as RequestInit).method === 'PUT'
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse((putCall![1] as RequestInit).body as string)
      expect(body.path).toBe(mockFilePath)
      expect(body.content).toBe('# Saved content')
    })
  })

  it('shows saved feedback after successful save', async () => {
    mockFetchResponses({
      '/knowledge/file/content': { message: 'File saved and re-ingested' },
      '/knowledge/file': { name: 'hello.md', path: mockFilePath, content: mockFileContent },
    })
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('editor-save-button'))

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeInTheDocument()
    })
  })

  it('calls onClose when cancel button is clicked', async () => {
    const onClose = vi.fn()
    mockFetchResponses({
      '/knowledge/file': { name: 'hello.md', path: mockFilePath, content: mockFileContent },
    })
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('editor-cancel-button'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables save button while saving', async () => {
    let resolvePromise: (v: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init?) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const method = init?.method?.toUpperCase() ?? 'GET'
      if (method === 'PUT') {
        return new Promise((resolve) => { resolvePromise = resolve })
      }
      return { ok: true, json: () => Promise.resolve({ name: 'hello.md', path: mockFilePath, content: mockFileContent }) } as Response
    })
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-save-button'))
    })

    expect(screen.getByTestId('editor-save-button')).toBeDisabled()

    await act(async () => {
      resolvePromise!({ ok: true, json: () => Promise.resolve({ message: 'saved' }) } as Response)
    })
  })

  it('shows error feedback on save failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init?) => {
      const method = init?.method?.toUpperCase() ?? 'GET'
      if (method === 'PUT') {
        return { ok: false, json: () => Promise.resolve({ detail: 'Save failed' }) } as Response
      }
      return { ok: true, json: () => Promise.resolve({ name: 'hello.md', path: mockFilePath, content: mockFileContent }) } as Response
    })
    render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('editor-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-error')).toBeInTheDocument()
    })
  })

  it('refetches content when filePath changes', async () => {
    const fetchSpy = mockFetchResponses({
      '/knowledge/file': { name: 'hello.md', path: mockFilePath, content: mockFileContent },
    })
    const { rerender } = render(<MarkdownEditor backendUrl={mockBackendUrl} filePath={mockFilePath} />)
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toBeInTheDocument()
    })

    const initialCalls = fetchSpy.mock.calls.length

    rerender(<MarkdownEditor backendUrl={mockBackendUrl} filePath="other/file.md" />)
    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialCalls)
    })
  })
})
