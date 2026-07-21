// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SettingsPage from '../../src/components/settings/SettingsPage'

const BACKEND = 'http://127.0.0.1:18200'

function mockBackend(memories: unknown[]) {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : null,
    })
    if (url.endsWith('/memories')) {
      return { ok: true, json: () => Promise.resolve({ memories }) } as Response
    }
    if (url.includes('/memories/')) {
      return { ok: true, json: () => Promise.resolve({ ok: true }) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
  return calls
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Settings memory section', () => {
  it('lists learned memories with kind badges', async () => {
    mockBackend([
      { id: 1, kind: 'semantic', content: '用户用Python刷题', created_at: '2026-07-16' },
      { id: 2, kind: 'procedural', content: '回答用中文', created_at: '2026-07-16' },
    ])
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.getByTestId('memory-item-1')).toHaveTextContent('用户用Python刷题')
      expect(screen.getByTestId('memory-item-1')).toHaveTextContent('fact')
      expect(screen.getByTestId('memory-item-2')).toHaveTextContent('rule')
    })
  })

  it('shows the empty state when nothing is learned', async () => {
    mockBackend([])
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => expect(screen.getByTestId('memory-empty')).toBeInTheDocument())
  })

  it('delete forgets the memory via DELETE', async () => {
    const calls = mockBackend([{ id: 7, kind: 'semantic', content: 'x', created_at: '' }])
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('memory-delete-7'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('memory-delete-7'))
    })
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/memories/7'))).toBe(true)
    await waitFor(() => expect(screen.queryByTestId('memory-item-7')).not.toBeInTheDocument())
  })

  it('inline edit PUTs the new content', async () => {
    const calls = mockBackend([{ id: 3, kind: 'semantic', content: '旧内容', created_at: '' }])
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('memory-item-3'))
    fireEvent.click(screen.getByText('旧内容'))
    const input = screen.getByTestId('memory-edit-input-3')
    await act(async () => {
      fireEvent.change(input, { target: { value: '新内容' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/memories/3'))
    expect((put?.body as { content: string }).content).toBe('新内容')
  })
})
