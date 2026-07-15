// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ChatArea from '../../src/components/layout/ChatArea'
import Sidebar from '../../src/components/layout/Sidebar'

const BACKEND = 'http://127.0.0.1:18200'

const sse =
  [
    { type: 'start' },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'ok' },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: 'stop' },
  ]
    .map((c) => `data: ${JSON.stringify(c)}\n\n`)
    .join('') + 'data: [DONE]\n\n'

function mockBackend(opts: { sessions?: unknown[]; history?: unknown[] } = {}) {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : null,
    })
    if (url.endsWith('/chat')) {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(sse))
          c.close()
        },
      })
      return { ok: true, status: 200, body: stream, headers: new Headers({ 'content-type': 'text/event-stream' }) } as unknown as Response
    }
    if (url.includes('/sessions') && url.endsWith('/messages')) {
      return { ok: true, json: () => Promise.resolve({ messages: opts.history ?? [] }) } as Response
    }
    if (url.endsWith('/sessions') && (init?.method ?? 'GET') === 'GET') {
      return { ok: true, json: () => Promise.resolve({ sessions: opts.sessions ?? [] }) } as Response
    }
    if (url.endsWith('/sessions')) {
      return { ok: true, json: () => Promise.resolve({ id: 'sess-new' }) } as Response
    }
    if (url.includes('/knowledge/tree')) {
      return { ok: true, json: () => Promise.resolve({ name: 'k', path: '', type: 'directory', children: [] }) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
  return calls
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChatArea sessions', () => {
  it('loads persisted history when a session is active', async () => {
    mockBackend({
      history: [
        { id: 1, role: 'user', content: '老问题', sources: [] },
        { id: 2, role: 'assistant', content: '老回答', sources: ['a.md'] },
      ],
    })
    render(<ChatArea backendUrl={BACKEND} sessionId="sess-1" />)
    await waitFor(() => {
      expect(screen.getByTestId('chat-area')).toHaveTextContent('老问题')
      expect(screen.getByTestId('chat-area')).toHaveTextContent('老回答')
    })
  })

  it('creates a session on first send and posts session_id in the body', async () => {
    const calls = mockBackend()
    const ensureSession = vi.fn(async () => 'sess-new')
    render(<ChatArea backendUrl={BACKEND} sessionId={null} ensureSession={ensureSession} />)

    const input = screen.getByPlaceholderText('Ask about your knowledge base...')
    await act(async () => {
      fireEvent.change(input, { target: { value: '第一问' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(ensureSession).toHaveBeenCalled()
    const chatCall = calls.find((c) => c.url.endsWith('/chat'))
    expect((chatCall?.body as { session_id?: string })?.session_id).toBe('sess-new')
  })
})

describe('Sidebar chats section', () => {
  it('lists sessions and selects on click', async () => {
    mockBackend({ sessions: [{ id: 's1', title: '区间DP的问题', updated_at: '2026-07-16' }] })
    const onSessionSelect = vi.fn()
    render(<Sidebar backendUrl={BACKEND} onSessionSelect={onSessionSelect} />)
    await waitFor(() => expect(screen.getByTestId('session-item-s1')).toHaveTextContent('区间DP的问题'))
    fireEvent.click(screen.getByTestId('session-item-s1'))
    expect(onSessionSelect).toHaveBeenCalledWith('s1')
  })

  it('new chat button clears the active session', async () => {
    mockBackend()
    const onSessionSelect = vi.fn()
    render(<Sidebar backendUrl={BACKEND} onSessionSelect={onSessionSelect} />)
    fireEvent.click(screen.getByTestId('new-chat-button'))
    expect(onSessionSelect).toHaveBeenCalledWith(null)
  })

  it('delete removes the session via DELETE', async () => {
    const calls = mockBackend({ sessions: [{ id: 's1', title: 't', updated_at: '2026-07-16' }] })
    render(<Sidebar backendUrl={BACKEND} />)
    await waitFor(() => screen.getByTestId('session-delete-s1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('session-delete-s1'))
    })
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/sessions/s1'))).toBe(true)
    await waitFor(() => expect(screen.queryByTestId('session-item-s1')).not.toBeInTheDocument())
  })
})
