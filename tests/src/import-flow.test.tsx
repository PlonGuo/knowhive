// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Sidebar from '../../src/components/layout/Sidebar'

const mockBackendUrl = 'http://127.0.0.1:18200'

const mockTree = {
  name: 'knowledge',
  path: '',
  type: 'directory',
  children: [
    { name: 'README.md', path: 'README.md', type: 'file' },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

function setupFetchMock(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    '/knowledge/tree': mockTree,
    ...overrides,
  }
  const sorted = Object.entries(responses).sort((a, b) => b[0].length - a[0].length)

  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    for (const [pattern, data] of sorted) {
      if (url.includes(pattern)) {
        if (typeof data === 'function') {
          const result = (data as () => unknown)()
          return { ok: true, json: () => Promise.resolve(result) } as Response
        }
        return { ok: true, json: () => Promise.resolve(data) } as Response
      }
    }
    return { ok: false, json: () => Promise.resolve({}) } as Response
  }) as unknown as typeof global.fetch

  vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)
}

function setupWindowApi(selectFilesResult: string[] = []) {
  Object.defineProperty(window, 'api', {
    value: {
      getBackendUrl: vi.fn().mockResolvedValue(mockBackendUrl),
      getSidecarStatus: vi.fn().mockResolvedValue('running'),
      selectFiles: vi.fn().mockResolvedValue(selectFilesResult),
    },
    writable: true,
    configurable: true,
  })
}

describe('Import Flow', () => {
  beforeEach(() => {
    setupWindowApi()
    setupFetchMock()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows + Import button by default', () => {
    render(<Sidebar backendUrl={mockBackendUrl} />)
    const btn = screen.getByTestId('import-button')
    expect(btn).toHaveTextContent('+ Import')
    expect(btn).not.toBeDisabled()
  })

  it('does not show progress bar in idle state', () => {
    render(<Sidebar backendUrl={mockBackendUrl} />)
    expect(screen.queryByTestId('import-progress')).not.toBeInTheDocument()
  })

  it('calls selectFiles on import click', async () => {
    const selectFiles = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'api', {
      value: {
        getBackendUrl: vi.fn().mockResolvedValue(mockBackendUrl),
        getSidecarStatus: vi.fn().mockResolvedValue('running'),
        selectFiles,
      },
      writable: true,
      configurable: true,
    })

    render(<Sidebar backendUrl={mockBackendUrl} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-button'))
    })

    expect(selectFiles).toHaveBeenCalled()
  })

  it('does nothing when file picker is cancelled (empty array)', async () => {
    setupWindowApi([])

    render(<Sidebar backendUrl={mockBackendUrl} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-button'))
    })

    expect(screen.queryByTestId('import-progress')).not.toBeInTheDocument()
  })

  it('shows progress bar and calls ingest API when files are selected', async () => {
    setupWindowApi(['/path/to/file1.md', '/path/to/file2.md'])
    // Return completed immediately to avoid polling issues
    setupFetchMock({
      '/ingest/files': { task_id: 'task-123', status: 'pending', total_files: 2 },
      '/ingest/status/task-123': { task_id: 'task-123', status: 'completed', total_files: 2, processed_files: 2, errors: null },
    })

    render(<Sidebar backendUrl={mockBackendUrl} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-button'))
    })

    // Should show progress bar
    await waitFor(() => {
      expect(screen.getByTestId('import-progress')).toBeInTheDocument()
    })

    // Verify ingest API was called with correct body
    const ingestCall = fetchMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/ingest/files')
    )
    expect(ingestCall).toBeDefined()
    const body = JSON.parse((ingestCall![1] as RequestInit).body as string)
    expect(body.file_paths).toEqual(['/path/to/file1.md', '/path/to/file2.md'])
  })

  it('disables import button while importing', async () => {
    setupWindowApi(['/path/to/file.md'])
    setupFetchMock({
      '/ingest/files': { task_id: 'task-dis', status: 'pending', total_files: 1 },
      '/ingest/status/task-dis': { task_id: 'task-dis', status: 'running', total_files: 1, processed_files: 0, errors: null },
    })

    render(<Sidebar backendUrl={mockBackendUrl} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-button'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('import-button')).toBeDisabled()
      expect(screen.getByTestId('import-button')).toHaveTextContent('Importing...')
    })
  })

  it('polls ingest status and shows completion', async () => {
    setupWindowApi(['/path/to/file.md'])

    let pollCount = 0
    setupFetchMock({
      '/ingest/files': { task_id: 'task-456', status: 'pending', total_files: 1 },
      '/ingest/status/task-456': () => {
        pollCount++
        if (pollCount >= 2) {
          return { task_id: 'task-456', status: 'completed', total_files: 1, processed_files: 1, errors: null }
        }
        return { task_id: 'task-456', status: 'running', total_files: 1, processed_files: 0, errors: null }
      },
    })

    render(<Sidebar backendUrl={mockBackendUrl} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-button'))
    })

    // Wait for polling to complete (500ms intervals, 2 polls needed)
    await waitFor(() => {
      expect(screen.getByTestId('import-status-text')).toHaveTextContent('Import complete!')
    }, { timeout: 3000 })
  })

  it('shows error state when ingest API returns error', async () => {
    setupWindowApi(['/path/to/file.md'])

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/ingest/files')) {
        return { ok: false, json: () => Promise.resolve({ error: 'Server error' }) } as Response
      }
      if (url.includes('/knowledge/tree')) {
        return { ok: true, json: () => Promise.resolve(mockTree) } as Response
      }
      return { ok: false, json: () => Promise.resolve({}) } as Response
    })

    render(<Sidebar backendUrl={mockBackendUrl} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-button'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('import-status-text')).toHaveTextContent('Failed to start import')
    })
  })

  it('shows error when ingest task fails', async () => {
    setupWindowApi(['/path/to/file.md'])
    setupFetchMock({
      '/ingest/files': { task_id: 'task-789', status: 'pending', total_files: 1 },
      '/ingest/status/task-789': { task_id: 'task-789', status: 'failed', total_files: 1, processed_files: 0, errors: 'Parse error' },
    })

    render(<Sidebar backendUrl={mockBackendUrl} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-button'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('import-status-text')).toHaveTextContent('Parse error')
    }, { timeout: 3000 })
  })

  it('handles PDF file imports alongside Markdown', async () => {
    setupWindowApi(['/path/to/doc.md', '/path/to/report.pdf'])
    setupFetchMock({
      '/ingest/files': { task_id: 'task-pdf', status: 'pending', total_files: 2 },
      '/ingest/status/task-pdf': { task_id: 'task-pdf', status: 'completed', total_files: 2, processed_files: 2, errors: null },
    })

    render(<Sidebar backendUrl={mockBackendUrl} />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-button'))
    })

    // Verify ingest API was called with both .md and .pdf paths
    const ingestCall = fetchMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/ingest/files')
    )
    expect(ingestCall).toBeDefined()
    const body = JSON.parse((ingestCall![1] as RequestInit).body as string)
    expect(body.file_paths).toEqual(['/path/to/doc.md', '/path/to/report.pdf'])

    await waitFor(() => {
      expect(screen.getByTestId('import-status-text')).toHaveTextContent('Import complete!')
    }, { timeout: 3000 })
  })

  it('refreshes file tree after successful import', async () => {
    setupWindowApi(['/path/to/file.md'])
    setupFetchMock({
      '/ingest/files': { task_id: 'task-refresh', status: 'pending', total_files: 1 },
      '/ingest/status/task-refresh': { task_id: 'task-refresh', status: 'completed', total_files: 1, processed_files: 1, errors: null },
    })

    render(<Sidebar backendUrl={mockBackendUrl} />)

    // Wait for initial tree load
    await waitFor(() => {
      expect(screen.getByTestId('filetree')).toBeInTheDocument()
    })

    const treeCallsBefore = fetchMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/knowledge/tree')
    ).length

    // Trigger import
    await act(async () => {
      fireEvent.click(screen.getByTestId('import-button'))
    })

    // Wait for completion
    await waitFor(() => {
      expect(screen.getByTestId('import-status-text')).toHaveTextContent('Import complete!')
    }, { timeout: 3000 })

    // Check that file tree was refreshed (additional /knowledge/tree call)
    const treeCallsAfter = fetchMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/knowledge/tree')
    ).length
    expect(treeCallsAfter).toBeGreaterThan(treeCallsBefore)
  })
})
