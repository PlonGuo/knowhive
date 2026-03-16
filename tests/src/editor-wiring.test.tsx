// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from '../../src/App'

const mockBackendUrl = 'http://127.0.0.1:18200'

function setupMocks(treeChildren: unknown[] = []) {
  Object.defineProperty(window, 'api', {
    value: {
      getBackendUrl: vi.fn().mockResolvedValue(mockBackendUrl),
      getSidecarStatus: vi.fn().mockResolvedValue('running'),
      selectFiles: vi.fn().mockResolvedValue([]),
    },
    writable: true,
    configurable: true,
  })

  const responses: Record<string, unknown> = {
    '/chat/history': { messages: [], total: 0 },
    '/health': { status: 'ok', version: '0.1.0' },
    '/knowledge/tree': {
      name: 'knowledge',
      path: '',
      type: 'directory',
      children: treeChildren,
    },
    '/knowledge/file?path=': { name: 'hello.md', content: '# Hello\n\nWorld' },
    '/knowledge/file/content': { status: 'ok' },
  }

  const sorted = Object.entries(responses).sort((a, b) => b[0].length - a[0].length)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init?) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    for (const [pattern, data] of sorted) {
      if (url.includes(pattern)) {
        return { ok: true, json: () => Promise.resolve(data) } as Response
      }
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
}

const treeWithFile = [
  { name: 'hello.md', path: 'hello.md', type: 'file' },
]

describe('FileTree click → editor view wiring', () => {
  beforeEach(() => {
    setupMocks(treeWithFile)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('clicking a file in the tree opens the MarkdownEditor', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('hello.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('hello.md'))

    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toBeInTheDocument()
    })
  })

  it('editor shows the correct filename', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('hello.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('hello.md'))

    await waitFor(() => {
      expect(screen.getByTestId('editor-filename')).toHaveTextContent('hello.md')
    })
  })

  it('chat area is hidden when editor is open', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('hello.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('hello.md'))

    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('chat-area')).not.toBeInTheDocument()
  })

  it('Cancel button in editor returns to chat view', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('hello.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('hello.md'))

    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('editor-cancel-button'))

    await waitFor(() => {
      expect(screen.getByTestId('chat-area')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument()
  })

  it('selected file is highlighted in the sidebar tree', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('hello.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('hello.md'))

    await waitFor(() => {
      const item = screen.getByText('hello.md').closest('[data-testid="filetree-item"]')
      expect(item).toHaveClass('bg-accent')
    })
  })

  it('settings view still works when editor was open', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('hello.md')).toBeInTheDocument()
    })

    // Open editor
    fireEvent.click(screen.getByText('hello.md'))
    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toBeInTheDocument()
    })

    // Switch to settings
    fireEvent.click(screen.getByTestId('settings-button'))
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument()
  })

  it('returning from settings goes to chat (not editor)', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('hello.md')).toBeInTheDocument()
    })

    // Open editor, then settings
    fireEvent.click(screen.getByText('hello.md'))
    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('settings-button'))
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    })

    // Go back from settings
    fireEvent.click(screen.getByText('← Back'))

    await waitFor(() => {
      expect(screen.getByTestId('chat-area')).toBeInTheDocument()
    })
  })
})
