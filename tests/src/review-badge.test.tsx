// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Sidebar from '../../src/components/layout/Sidebar'

// The review badge lives in the sidebar footer (the status bar was removed by design).

const mockTree = { name: 'knowledge', path: '', type: 'directory', children: [] }

function mockFetch(stats: { total: number; due_today: number }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/review/stats')) {
      return { ok: true, json: () => Promise.resolve(stats) } as Response
    }
    if (url.includes('/knowledge/tree')) {
      return { ok: true, json: () => Promise.resolve(mockTree) } as Response
    }
    return { ok: false, json: () => Promise.resolve({}) } as Response
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Sidebar review badge', () => {
  it('shows due count badge when items are due', async () => {
    mockFetch({ total: 10, due_today: 5 })
    render(<Sidebar backendUrl="http://127.0.0.1:18200" />)
    await waitFor(() => {
      expect(screen.getByTestId('review-badge')).toBeInTheDocument()
    })
    expect(screen.getByTestId('review-badge')).toHaveTextContent('5')
  })

  it('hides badge when no items due', async () => {
    mockFetch({ total: 5, due_today: 0 })
    render(<Sidebar backendUrl="http://127.0.0.1:18200" />)
    await waitFor(() => {
      expect(screen.getByTestId('filetree')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('review-badge')).not.toBeInTheDocument()
  })

  it('calls onReviewClick when badge is clicked', async () => {
    mockFetch({ total: 3, due_today: 3 })
    const onReviewClick = vi.fn()
    render(<Sidebar backendUrl="http://127.0.0.1:18200" onReviewClick={onReviewClick} />)
    await waitFor(() => {
      expect(screen.getByTestId('review-badge')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('review-badge'))
    expect(onReviewClick).toHaveBeenCalledTimes(1)
  })

  it('theme toggle lives in the sidebar footer and flips the root class', async () => {
    mockFetch({ total: 0, due_today: 0 })
    render(<Sidebar backendUrl="http://127.0.0.1:18200" />)
    const toggle = await screen.findByTestId('theme-toggle')
    const wasDark = document.documentElement.classList.contains('dark')
    fireEvent.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(!wasDark)
    fireEvent.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(wasDark)
  })
})
