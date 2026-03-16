// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import FileTree from '../../src/components/knowledge/FileTree'

const mockBackendUrl = 'http://127.0.0.1:18200'

const mockTree = {
  name: 'knowledge',
  path: '',
  type: 'directory',
  children: [
    {
      name: 'guides',
      path: 'guides',
      type: 'directory',
      children: [
        { name: 'setup.md', path: 'guides/setup.md', type: 'file' },
        { name: 'usage.md', path: 'guides/usage.md', type: 'file' },
      ],
    },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ],
}

function mockFetchResponses(responses: Record<string, unknown>) {
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

describe('FileTree', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<FileTree backendUrl={mockBackendUrl} />)
    expect(screen.getByTestId('filetree')).toBeInTheDocument()
  })

  it('fetches and displays the file tree', async () => {
    mockFetchResponses({ '/knowledge/tree': mockTree })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('guides')).toBeInTheDocument()
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })
  })

  it('shows empty state when tree has no children', async () => {
    mockFetchResponses({
      '/knowledge/tree': { name: 'knowledge', path: '', type: 'directory', children: [] },
    })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('No files imported yet')).toBeInTheDocument()
    })
  })

  it('collapses and expands directories on click', async () => {
    mockFetchResponses({ '/knowledge/tree': mockTree })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('guides')).toBeInTheDocument()
    })

    // Files inside "guides" should be visible (directories start expanded)
    expect(screen.getByText('setup.md')).toBeInTheDocument()

    // Click to collapse
    fireEvent.click(screen.getByText('guides'))
    expect(screen.queryByText('setup.md')).not.toBeInTheDocument()

    // Click to expand again
    fireEvent.click(screen.getByText('guides'))
    expect(screen.getByText('setup.md')).toBeInTheDocument()
  })

  it('calls onFileSelect when a file is clicked', async () => {
    mockFetchResponses({ '/knowledge/tree': mockTree })
    const onFileSelect = vi.fn()
    render(<FileTree backendUrl={mockBackendUrl} onFileSelect={onFileSelect} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('README.md'))
    expect(onFileSelect).toHaveBeenCalledWith('README.md')
  })

  it('calls onFileSelect with nested file path', async () => {
    mockFetchResponses({ '/knowledge/tree': mockTree })
    const onFileSelect = vi.fn()
    render(<FileTree backendUrl={mockBackendUrl} onFileSelect={onFileSelect} />)
    await waitFor(() => {
      expect(screen.getByText('setup.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('setup.md'))
    expect(onFileSelect).toHaveBeenCalledWith('guides/setup.md')
  })

  it('shows error state when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('Failed to load files')).toBeInTheDocument()
    })
  })

  it('highlights the selected file', async () => {
    mockFetchResponses({ '/knowledge/tree': mockTree })
    render(<FileTree backendUrl={mockBackendUrl} selectedPath="README.md" />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })
    const item = screen.getByText('README.md').closest('[data-testid="filetree-item"]')
    expect(item).toHaveClass('bg-accent')
  })

  it('can refresh tree via refresh callback', async () => {
    const fetchSpy = mockFetchResponses({ '/knowledge/tree': mockTree })
    let refreshFn: (() => void) | undefined
    render(
      <FileTree
        backendUrl={mockBackendUrl}
        onRefreshReady={(fn) => { refreshFn = fn }}
      />
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    // Initial fetch
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Trigger refresh
    refreshFn!()
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
  })
})
