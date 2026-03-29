// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import KnowledgeOverview from '../../src/components/knowledge/KnowledgeOverview'

const mockBackendUrl = 'http://127.0.0.1:18200'

const sampleTree = {
  name: 'knowledge',
  path: '',
  type: 'directory',
  children: [
    {
      name: 'python',
      path: 'python',
      type: 'directory',
      children: [
        { name: 'intro.md', path: 'python/intro.md', type: 'file', size: 1024 },
        { name: 'advanced.md', path: 'python/advanced.md', type: 'file', size: 2048 },
      ],
    },
  ],
}

const emptyTree = { name: 'knowledge', path: '', type: 'directory', children: [] }

function mockFetch(opts: { summary?: string | null; tree?: object } = {}) {
  const { summary = 'A summary of the document.', tree = sampleTree } = opts
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = init?.method ?? 'GET'
    if (url.includes('/knowledge/tree')) {
      return { ok: true, json: () => Promise.resolve(tree) } as Response
    }
    if (url.includes('/summary/cached') && method === 'POST') {
      if (summary === null) {
        return { ok: true, json: () => Promise.resolve([]) } as Response
      }
      // Return cached summaries for all requested files
      const body = JSON.parse(init?.body as string)
      const results = (body.file_paths as string[]).map((fp: string) => ({
        file_path: fp,
        summary,
      }))
      return { ok: true, json: () => Promise.resolve(results) } as Response
    }
    if (url.includes('/summary/generate') && method === 'POST') {
      return { ok: true, json: () => Promise.resolve({ summary: 'Generated summary.' }) } as Response
    }
    return { ok: false } as Response
  })
}

describe('KnowledgeOverview', () => {
  beforeEach(() => {
    mockFetch()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders knowledge overview heading', () => {
    render(<KnowledgeOverview backendUrl={mockBackendUrl} />)
    expect(screen.getByRole('heading', { name: /knowledge/i })).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    render(<KnowledgeOverview backendUrl={mockBackendUrl} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('displays list of knowledge files', async () => {
    render(<KnowledgeOverview backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('intro.md')).toBeInTheDocument()
      expect(screen.getByText('advanced.md')).toBeInTheDocument()
    })
  })

  it('shows cached summary for each file when available', async () => {
    render(<KnowledgeOverview backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      const summaries = screen.getAllByText('A summary of the document.')
      expect(summaries.length).toBeGreaterThan(0)
    })
  })

  it('shows generate button when no cached summary', async () => {
    vi.restoreAllMocks()
    mockFetch({ summary: null, tree: sampleTree })
    render(<KnowledgeOverview backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      const generateBtns = screen.getAllByTestId(/generate-summary/)
      expect(generateBtns.length).toBeGreaterThan(0)
    })
  })

  it('fetches summary on generate button click', async () => {
    vi.restoreAllMocks()
    const spy = mockFetch({ summary: null, tree: sampleTree })
    render(<KnowledgeOverview backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getAllByTestId(/generate-summary/).length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getAllByTestId(/generate-summary/)[0])
    await waitFor(() => {
      const postCalls = spy.mock.calls.filter((c) => String(c[0]).includes('/summary/generate'))
      expect(postCalls.length).toBeGreaterThan(0)
    })
  })

  it('shows back button and calls onBack', () => {
    const onBack = vi.fn()
    render(<KnowledgeOverview backendUrl={mockBackendUrl} onBack={onBack} />)
    const backBtn = screen.getByTestId('overview-back-button')
    fireEvent.click(backBtn)
    expect(onBack).toHaveBeenCalled()
  })

  it('shows empty state when no files', async () => {
    vi.restoreAllMocks()
    mockFetch({ tree: emptyTree })
    render(<KnowledgeOverview backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('no-files-message')).toBeInTheDocument()
    })
  })

  it('shows file path for each document', async () => {
    render(<KnowledgeOverview backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('python/intro.md')).toBeInTheDocument()
    })
  })

  it('shows error when fetch fails', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    render(<KnowledgeOverview backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument()
    })
  })
})
