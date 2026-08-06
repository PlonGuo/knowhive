// @vitest-environment happy-dom
// The badge's whole job is to appear only while a background re-index is running, so
// both halves of that are the test: silent when idle, visible when syncing.
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReindexBadge from '../../src/components/layout/ReindexBadge'

const mockWatcher = (body: unknown, ok = true) => {
  global.fetch = vi.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch
}

describe('ReindexBadge', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders nothing while the watcher is idle', async () => {
    mockWatcher({ running: true, syncing: false })
    render(<ReindexBadge backendUrl="http://x" />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('reindex-badge')).toBeNull()
  })

  it('appears while the watcher is syncing', async () => {
    mockWatcher({ running: true, syncing: true })
    render(<ReindexBadge backendUrl="http://x" />)
    expect(await screen.findByTestId('reindex-badge')).toBeTruthy()
  })

  it('explains the slowdown rather than just reporting activity', async () => {
    mockWatcher({ running: true, syncing: true })
    render(<ReindexBadge backendUrl="http://x" />)
    const badge = await screen.findByTestId('reindex-badge')
    // The measured number is the point: an unexplained 2x stall reads as a broken app.
    expect(badge.getAttribute('title')).toMatch(/slower/i)
  })

  it('stays silent when the status call fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('sidecar down')) as unknown as typeof fetch
    render(<ReindexBadge backendUrl="http://x" />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('reindex-badge')).toBeNull()
  })

  it('stays silent on a non-ok response', async () => {
    mockWatcher(null, false)
    render(<ReindexBadge backendUrl="http://x" />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('reindex-badge')).toBeNull()
  })
})
