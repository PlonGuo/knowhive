// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import CommunityBrowser from '../../src/components/community/CommunityBrowser'

const mockBackendUrl = 'http://127.0.0.1:18200'

const samplePacks = [
  {
    id: 'python-basics',
    name: 'Python Basics',
    description: 'Core Python concepts',
    author: 'KnowHive',
    tags: ['python'],
    file_count: 2,
    size_kb: 50,
    path: 'packs/python-basics',
    imported: false,
  },
  {
    id: 'git-cheatsheet',
    name: 'Git Cheatsheet',
    description: 'Git commands reference',
    author: 'KnowHive',
    tags: ['git', 'devops'],
    file_count: 1,
    size_kb: 20,
    path: 'packs/git-cheatsheet',
    imported: true,
  },
]

function mockFetch(responses: Record<string, unknown>) {
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

describe('CommunityBrowser', () => {
  beforeEach(() => {
    mockFetch({ '/community/packs': samplePacks })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders community browser heading', async () => {
    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    expect(screen.getByRole('heading', { name: /community/i })).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('fetches and displays pack list', async () => {
    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('Python Basics')).toBeInTheDocument()
      expect(screen.getByText('Git Cheatsheet')).toBeInTheDocument()
    })
  })

  it('shows pack description', async () => {
    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('Core Python concepts')).toBeInTheDocument()
    })
  })

  it('shows pack author', async () => {
    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      const authorEls = screen.getAllByText(/KnowHive/)
      expect(authorEls.length).toBeGreaterThan(0)
    })
  })

  it('shows tags for each pack', async () => {
    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('python')).toBeInTheDocument()
      expect(screen.getByText('git')).toBeInTheDocument()
    })
  })

  it('shows import button for non-imported packs', async () => {
    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('import-pack-python-basics')).toBeInTheDocument()
    })
  })

  it('shows "Imported" indicator for already imported packs', async () => {
    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('imported-badge-git-cheatsheet')).toBeInTheDocument()
    })
  })

  it('filters packs by search query', async () => {
    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('Python Basics')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/search/i)
    fireEvent.change(searchInput, { target: { value: 'git' } })

    await waitFor(() => {
      expect(screen.queryByText('Python Basics')).not.toBeInTheDocument()
      expect(screen.getByText('Git Cheatsheet')).toBeInTheDocument()
    })
  })

  it('calls POST /community/import when import button clicked', async () => {
    const fetchSpy = mockFetch({
      '/community/packs': samplePacks,
      '/community/import': { task_id: 'abc123', status: 'imported', pack_id: 'python-basics', file_count: 2 },
    })

    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('import-pack-python-basics')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('import-pack-python-basics'))

    await waitFor(() => {
      const calls = fetchSpy.mock.calls
      const importCall = calls.find((c) => String(c[0]).includes('/community/import'))
      expect(importCall).toBeTruthy()
    })
  })

  it('shows error message when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'))

    render(<CommunityBrowser backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument()
    })
  })

  it('shows back button and calls onBack when clicked', async () => {
    const onBack = vi.fn()
    render(<CommunityBrowser backendUrl={mockBackendUrl} onBack={onBack} />)

    const backBtn = screen.getByTestId('community-back-button')
    fireEvent.click(backBtn)
    expect(onBack).toHaveBeenCalled()
  })
})
