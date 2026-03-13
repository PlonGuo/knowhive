// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ReviewPage from '../../src/components/review/ReviewPage'

const mockBackendUrl = 'http://127.0.0.1:18200'

const sampleItem = {
  id: 1,
  file_path: 'packs/python/intro.md',
  question: 'What is a list?',
  answer: 'An ordered mutable sequence.',
  repetitions: 0,
  easiness: 2.5,
  interval: 1,
  due_date: '2026-03-13',
}

function mockFetch(summaryResponse?: { summary: string } | null) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = init?.method ?? 'GET'
    if (url.includes('/review/due')) {
      return { ok: true, json: () => Promise.resolve([sampleItem]) } as Response
    }
    if (url.includes('/review/record')) {
      return { ok: true, json: () => Promise.resolve({ ...sampleItem, repetitions: 1 }) } as Response
    }
    if (url.includes('/summary/generate')) {
      if (summaryResponse === null) {
        return { ok: false, status: 404, json: () => Promise.resolve({ detail: 'Not found' }) } as Response
      }
      return { ok: true, json: () => Promise.resolve(summaryResponse ?? { summary: 'Python lists are ordered sequences.' }) } as Response
    }
    return { ok: false } as Response
  })
}

describe('ReviewPage AI summary integration', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows "Show AI Summary" button after revealing answer', async () => {
    mockFetch()
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('show-answer-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-answer-button'))
    await waitFor(() => {
      expect(screen.getByTestId('show-summary-button')).toBeInTheDocument()
    })
  })

  it('fetches and displays AI summary when button clicked', async () => {
    mockFetch({ summary: 'Python lists are ordered sequences.' })
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('show-answer-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-answer-button'))
    await waitFor(() => {
      expect(screen.getByTestId('show-summary-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-summary-button'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
      expect(screen.getByTestId('ai-summary')).toHaveTextContent('Python lists are ordered sequences.')
    })
  })

  it('calls POST /summary/generate with correct file_path', async () => {
    const spy = mockFetch({ summary: 'A summary.' })
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => {
      expect(screen.getByTestId('show-answer-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-answer-button'))
    await waitFor(() => {
      expect(screen.getByTestId('show-summary-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-summary-button'))

    await waitFor(() => {
      const summaryCalls = spy.mock.calls.filter((c) => String(c[0]).includes('/summary/generate'))
      expect(summaryCalls.length).toBeGreaterThan(0)
      const body = JSON.parse(summaryCalls[0][1]?.body as string)
      expect(body.file_path).toBe('packs/python/intro.md')
    })
  })

  it('hides "Show AI Summary" button when summary is visible', async () => {
    mockFetch({ summary: 'A summary.' })
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => screen.getByTestId('show-answer-button'))
    fireEvent.click(screen.getByTestId('show-answer-button'))
    await waitFor(() => screen.getByTestId('show-summary-button'))
    fireEvent.click(screen.getByTestId('show-summary-button'))

    await waitFor(() => {
      expect(screen.getByTestId('ai-summary')).toBeInTheDocument()
      expect(screen.queryByTestId('show-summary-button')).not.toBeInTheDocument()
    })
  })

  it('resets summary state when advancing to next card', async () => {
    mockFetch({ summary: 'A summary.' })
    render(<ReviewPage backendUrl={mockBackendUrl} />)
    await waitFor(() => screen.getByTestId('show-answer-button'))
    fireEvent.click(screen.getByTestId('show-answer-button'))
    await waitFor(() => screen.getByTestId('show-summary-button'))
    fireEvent.click(screen.getByTestId('show-summary-button'))
    await waitFor(() => screen.getByTestId('ai-summary'))

    // Record review to advance
    fireEvent.click(screen.getByTestId('quality-button-3'))

    // Done — no more cards
    await waitFor(() => {
      expect(screen.getByTestId('review-complete')).toBeInTheDocument()
    })
  })
})
