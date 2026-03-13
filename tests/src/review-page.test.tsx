// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ReviewPage from '../../src/components/review/ReviewPage'

const mockBackendUrl = 'http://127.0.0.1:18200'

const sampleItems = [
  {
    id: 1,
    file_path: 'packs/python/intro.md',
    question: 'What is a list?',
    answer: 'An ordered mutable sequence.',
    repetitions: 0,
    easiness: 2.5,
    interval: 1,
    due_date: '2026-03-13',
  },
  {
    id: 2,
    file_path: 'packs/python/intro.md',
    question: 'What is a tuple?',
    answer: 'An ordered immutable sequence.',
    repetitions: 0,
    easiness: 2.5,
    interval: 1,
    due_date: '2026-03-13',
  },
]

function mockFetch(items = sampleItems) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = init?.method ?? 'GET'
    if (url.includes('/review/due') && method === 'GET') {
      return { ok: true, json: () => Promise.resolve(items) } as Response
    }
    if (url.includes('/review/record') && method === 'POST') {
      return { ok: true, json: () => Promise.resolve({ ...items[0], repetitions: 1 }) } as Response
    }
    return { ok: false } as Response
  })
}

describe('ReviewPage', () => {
  beforeEach(() => {
    mockFetch()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders review page heading', async () => {
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    expect(screen.getByRole('heading', { name: /review/i })).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('displays the first question after load', async () => {
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('What is a list?')).toBeInTheDocument()
    })
  })

  it('hides answer initially (card face down)', async () => {
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('What is a list?')).toBeInTheDocument()
    })
    expect(screen.queryByText('An ordered mutable sequence.')).not.toBeInTheDocument()
  })

  it('shows answer after clicking show answer button', async () => {
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('show-answer-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-answer-button'))
    expect(screen.getByText('An ordered mutable sequence.')).toBeInTheDocument()
  })

  it('shows quality buttons after revealing answer', async () => {
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('show-answer-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-answer-button'))
    expect(screen.getByTestId('quality-button-0')).toBeInTheDocument()
    expect(screen.getByTestId('quality-button-3')).toBeInTheDocument()
    expect(screen.getByTestId('quality-button-4')).toBeInTheDocument()
  })

  it('calls POST /review/record with correct quality', async () => {
    const spy = mockFetch()
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('show-answer-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-answer-button'))
    fireEvent.click(screen.getByTestId('quality-button-3'))

    await waitFor(() => {
      const postCalls = spy.mock.calls.filter((c) => String(c[0]).includes('/review/record'))
      expect(postCalls.length).toBeGreaterThan(0)
      const body = JSON.parse(postCalls[0][1]?.body as string)
      expect(body.quality).toBe(3)
    })
  })

  it('advances to next card after recording quality', async () => {
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('What is a list?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-answer-button'))
    fireEvent.click(screen.getByTestId('quality-button-3'))

    await waitFor(() => {
      expect(screen.getByText('What is a tuple?')).toBeInTheDocument()
    })
  })

  it('shows completion message when all cards reviewed', async () => {
    mockFetch([sampleItems[0]])  // only one item
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByText('What is a list?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-answer-button'))
    fireEvent.click(screen.getByTestId('quality-button-3'))

    await waitFor(() => {
      expect(screen.getByTestId('review-complete')).toBeInTheDocument()
    })
  })

  it('shows progress as X / Y cards', async () => {
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('review-progress')).toBeInTheDocument()
    })
  })

  it('shows back button and calls onBack', async () => {
    const onBack = vi.fn()
    render(<ReviewPage backendUrl={mockBackendUrl} onBack={onBack} />)
    const backBtn = screen.getByTestId('review-back-button')
    fireEvent.click(backBtn)
    expect(onBack).toHaveBeenCalled()
  })

  it('shows empty state when no items due', async () => {
    vi.restoreAllMocks()
    mockFetch([])
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('review-complete')).toBeInTheDocument()
    })
  })
})
