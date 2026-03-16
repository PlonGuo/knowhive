// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
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
      ],
    },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ],
}

function mockFetchResponses(responses: Record<string, unknown>) {
  const sorted = Object.entries(responses).sort((a, b) => b[0].length - a[0].length)
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init?) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = init?.method?.toUpperCase() || 'GET'

    // Handle DELETE requests
    if (method === 'DELETE') {
      for (const [pattern, data] of sorted) {
        if (url.includes(pattern)) {
          return { ok: true, json: () => Promise.resolve(data) } as Response
        }
      }
      return { ok: true, json: () => Promise.resolve({ status: 'deleted' }) } as Response
    }

    // Handle PUT requests
    if (method === 'PUT') {
      for (const [pattern, data] of sorted) {
        if (url.includes(pattern)) {
          return { ok: true, json: () => Promise.resolve(data) } as Response
        }
      }
      return { ok: true, json: () => Promise.resolve({ status: 'renamed' }) } as Response
    }

    // Handle GET requests
    for (const [pattern, data] of sorted) {
      if (url.includes(pattern)) {
        return { ok: true, json: () => Promise.resolve(data) } as Response
      }
    }
    return { ok: false, json: () => Promise.resolve({}) } as Response
  })
}

describe('FileTree Context Menu', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows context menu on right-click of a file', async () => {
    mockFetchResponses({ '/knowledge/tree': mockTree })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('README.md'))
    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('does not show context menu on right-click of a directory', async () => {
    mockFetchResponses({ '/knowledge/tree': mockTree })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('guides')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('guides'))
    expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument()
  })

  it('closes context menu on outside click', async () => {
    mockFetchResponses({ '/knowledge/tree': mockTree })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('README.md'))
    expect(screen.getByTestId('context-menu')).toBeInTheDocument()

    // Click outside to close
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument()
  })

  it('deletes file after confirmation', async () => {
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
    const fetchSpy = mockFetchResponses({
      '/knowledge/tree': mockTree,
      '/knowledge/file': { path: 'README.md', status: 'deleted' },
    })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('README.md'))
    fireEvent.click(screen.getByText('Delete'))

    expect(confirmSpy).toHaveBeenCalledWith('Delete "README.md"?')

    // Should have called DELETE /knowledge/file?path=README.md
    await waitFor(() => {
      const deleteCalls = fetchSpy.mock.calls.filter(
        ([url, opts]) => {
          const u = typeof url === 'string' ? url : (url as Request).url
          return u.includes('/knowledge/file') && opts?.method === 'DELETE'
        }
      )
      expect(deleteCalls.length).toBe(1)
      expect(deleteCalls[0][0]).toContain('path=README.md')
    })
  })

  it('does not delete file when confirmation is cancelled', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    const fetchSpy = mockFetchResponses({ '/knowledge/tree': mockTree })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('README.md'))
    fireEvent.click(screen.getByText('Delete'))

    // No DELETE call should have been made
    const deleteCalls = fetchSpy.mock.calls.filter(
      ([, opts]) => opts?.method === 'DELETE'
    )
    expect(deleteCalls.length).toBe(0)
  })

  it('refreshes tree after successful delete', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
    const fetchSpy = mockFetchResponses({
      '/knowledge/tree': mockTree,
      '/knowledge/file': { status: 'deleted' },
    })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('README.md'))
    fireEvent.click(screen.getByText('Delete'))

    // Wait for the tree to be refreshed (2 GET calls: initial + post-delete)
    await waitFor(() => {
      const treeCalls = fetchSpy.mock.calls.filter(([url]) => {
        const u = typeof url === 'string' ? url : (url as Request).url
        return u.includes('/knowledge/tree')
      })
      expect(treeCalls.length).toBe(2)
    })
  })

  it('enters rename mode and submits new name', async () => {
    const fetchSpy = mockFetchResponses({
      '/knowledge/tree': mockTree,
      '/knowledge/file': { old_path: 'README.md', new_path: 'NOTES.md', status: 'renamed' },
    })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('README.md'))
    fireEvent.click(screen.getByText('Rename'))

    // Should show an input field with the current name
    const input = screen.getByTestId('rename-input') as HTMLInputElement
    expect(input.value).toBe('README.md')

    // Change value and submit via Enter
    fireEvent.change(input, { target: { value: 'NOTES.md' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Should have called PUT /knowledge/file
    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        ([, opts]) => opts?.method === 'PUT'
      )
      expect(putCalls.length).toBe(1)
      const body = JSON.parse(putCalls[0][1]?.body as string)
      expect(body.old_path).toBe('README.md')
      expect(body.new_path).toBe('NOTES.md')
    })
  })

  it('cancels rename on Escape key', async () => {
    const fetchSpy = mockFetchResponses({ '/knowledge/tree': mockTree })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('README.md'))
    fireEvent.click(screen.getByText('Rename'))

    const input = screen.getByTestId('rename-input')
    fireEvent.keyDown(input, { key: 'Escape' })

    // Input should be gone, original name visible
    expect(screen.queryByTestId('rename-input')).not.toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()

    // No PUT call
    const putCalls = fetchSpy.mock.calls.filter(
      ([, opts]) => opts?.method === 'PUT'
    )
    expect(putCalls.length).toBe(0)
  })

  it('refreshes tree after successful rename', async () => {
    const fetchSpy = mockFetchResponses({
      '/knowledge/tree': mockTree,
      '/knowledge/file': { status: 'renamed' },
    })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('README.md'))
    fireEvent.click(screen.getByText('Rename'))
    const input = screen.getByTestId('rename-input')
    fireEvent.change(input, { target: { value: 'CHANGED.md' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Wait for tree refresh (2 GET /knowledge/tree calls)
    await waitFor(() => {
      const treeCalls = fetchSpy.mock.calls.filter(([url]) => {
        const u = typeof url === 'string' ? url : (url as Request).url
        return u.includes('/knowledge/tree')
      })
      expect(treeCalls.length).toBe(2)
    })
  })

  it('does not rename when name is unchanged', async () => {
    const fetchSpy = mockFetchResponses({ '/knowledge/tree': mockTree })
    render(<FileTree backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.contextMenu(screen.getByText('README.md'))
    fireEvent.click(screen.getByText('Rename'))

    const input = screen.getByTestId('rename-input')
    // Submit without changing (same name)
    fireEvent.keyDown(input, { key: 'Enter' })

    // No PUT call
    const putCalls = fetchSpy.mock.calls.filter(
      ([, opts]) => opts?.method === 'PUT'
    )
    expect(putCalls.length).toBe(0)
    // Input should be gone
    expect(screen.queryByTestId('rename-input')).not.toBeInTheDocument()
  })
})
