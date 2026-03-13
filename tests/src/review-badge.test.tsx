// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import StatusBar from '../../src/components/layout/StatusBar'

const mockConfig = { llm_provider: 'ollama', model_name: 'llama3' }
const watcherResponse = { running: true, syncing: false }

function mockFetch(stats: { total: number; due_today: number }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/review/stats')) {
      return { ok: true, json: () => Promise.resolve(stats) } as Response
    }
    if (url.includes('/config')) {
      return { ok: true, json: () => Promise.resolve(mockConfig) } as Response
    }
    if (url.includes('/watcher')) {
      return { ok: true, json: () => Promise.resolve(watcherResponse) } as Response
    }
    return { ok: false } as Response
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('StatusBar review badge', () => {
  it('shows due count badge when items are due', async () => {
    mockFetch({ total: 10, due_today: 5 })
    render(
      <StatusBar
        health={{ status: 'ok', version: '0.1.0' }}
        error={null}
        backendUrl="http://127.0.0.1:18200"
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('review-badge')).toBeInTheDocument()
    })
    expect(screen.getByTestId('review-badge')).toHaveTextContent('5')
  })

  it('hides badge when no items due', async () => {
    mockFetch({ total: 5, due_today: 0 })
    render(
      <StatusBar
        health={{ status: 'ok', version: '0.1.0' }}
        error={null}
        backendUrl="http://127.0.0.1:18200"
      />,
    )
    // Wait for data to load
    await waitFor(() => {
      // watcher/config should load; badge should NOT appear
      expect(screen.queryByTestId('review-badge')).not.toBeInTheDocument()
    })
  })

  it('calls onReviewClick when badge is clicked', async () => {
    mockFetch({ total: 3, due_today: 3 })
    const onReviewClick = vi.fn()
    render(
      <StatusBar
        health={{ status: 'ok', version: '0.1.0' }}
        error={null}
        backendUrl="http://127.0.0.1:18200"
        onReviewClick={onReviewClick}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('review-badge')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('review-badge'))
    expect(onReviewClick).toHaveBeenCalledTimes(1)
  })

  it('does not show badge when backend unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    render(
      <StatusBar
        health={null}
        error="Disconnected"
        backendUrl="http://127.0.0.1:18200"
      />,
    )
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('review-badge')).not.toBeInTheDocument()
  })

  it('polls review stats on mount', async () => {
    const spy = mockFetch({ total: 2, due_today: 2 })
    render(
      <StatusBar
        health={{ status: 'ok', version: '0.1.0' }}
        error={null}
        backendUrl="http://127.0.0.1:18200"
      />,
    )
    await waitFor(() => {
      const reviewCalls = spy.mock.calls.filter((c) => String(c[0]).includes('/review/stats'))
      expect(reviewCalls.length).toBeGreaterThan(0)
    })
  })

  it('shows review badge with label text', async () => {
    mockFetch({ total: 10, due_today: 7 })
    render(
      <StatusBar
        health={{ status: 'ok', version: '0.1.0' }}
        error={null}
        backendUrl="http://127.0.0.1:18200"
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('review-badge')).toBeInTheDocument()
    })
    expect(screen.getByTestId('review-badge').textContent).toContain('7')
  })

  it('passes onReviewClick prop', () => {
    mockFetch({ total: 0, due_today: 0 })
    const onReviewClick = vi.fn()
    // Should not throw when prop is provided
    expect(() =>
      render(
        <StatusBar
          health={{ status: 'ok', version: '0.1.0' }}
          error={null}
          backendUrl="http://127.0.0.1:18200"
          onReviewClick={onReviewClick}
        />,
      ),
    ).not.toThrow()
  })
})
