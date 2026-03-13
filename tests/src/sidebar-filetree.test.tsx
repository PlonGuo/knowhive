// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
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

describe('Sidebar with FileTree', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: {
        getBackendUrl: vi.fn().mockResolvedValue(mockBackendUrl),
        getSidecarStatus: vi.fn().mockResolvedValue('running'),
        selectFiles: vi.fn().mockResolvedValue([]),
      },
      writable: true,
      configurable: true,
    })
    mockFetchResponses({ '/knowledge/tree': mockTree })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the file tree inside sidebar', async () => {
    render(<Sidebar backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('filetree')).toBeInTheDocument()
    })
  })

  it('has an import button', () => {
    render(<Sidebar backendUrl={mockBackendUrl} />)
    expect(screen.getByTestId('import-button')).toBeInTheDocument()
  })

  it('import button triggers IPC file picker', async () => {
    const selectFiles = vi.fn().mockResolvedValue(['/path/to/file.md'])
    Object.defineProperty(window, 'api', {
      value: {
        getBackendUrl: vi.fn().mockResolvedValue(mockBackendUrl),
        getSidecarStatus: vi.fn().mockResolvedValue('running'),
        selectFiles: selectFiles,
      },
      writable: true,
      configurable: true,
    })

    render(<Sidebar backendUrl={mockBackendUrl} />)
    fireEvent.click(screen.getByTestId('import-button'))

    await waitFor(() => {
      expect(selectFiles).toHaveBeenCalled()
    })
  })

  it('calls onFileSelect when a file in the tree is clicked', async () => {
    const onFileSelect = vi.fn()
    render(<Sidebar backendUrl={mockBackendUrl} onFileSelect={onFileSelect} />)
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('README.md'))
    expect(onFileSelect).toHaveBeenCalledWith('README.md')
  })

  it('still has settings button', () => {
    render(<Sidebar backendUrl={mockBackendUrl} />)
    expect(screen.getByTestId('settings-button')).toBeInTheDocument()
  })
})
