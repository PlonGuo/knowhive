// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import ChatArea from '../../src/components/layout/ChatArea'

// ── Helpers ──────────────────────────────────────────────────────

function mockFetchResponses(responses: Record<string, unknown>) {
  const sorted = Object.entries(responses).sort((a, b) => b[0].length - a[0].length)
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = init?.method?.toUpperCase() ?? 'GET'

    for (const [pattern, data] of sorted) {
      if (url.includes(pattern)) {
        if (pattern === '/chat' && method === 'POST') {
          const sseData = data as string
          const encoder = new TextEncoder()
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sseData))
              controller.close()
            },
          })
          return {
            ok: true,
            body: stream,
            headers: new Headers({ 'content-type': 'text/event-stream' }),
          } as unknown as Response
        }
        if (method === 'DELETE') {
          return { ok: true, json: () => Promise.resolve(data) } as Response
        }
        return { ok: true, json: () => Promise.resolve(data) } as Response
      }
    }
    return { ok: false, json: () => Promise.resolve({}) } as Response
  })
}

function ssePayload(events: Array<{ event: string; data: Record<string, unknown> }>): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')
}

/** Fire change then keyDown in separate act blocks so React flushes state between them */
async function typeAndSend(input: HTMLElement, text: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value: text } })
  })
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' })
  })
  // Allow async stream processing to complete
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const BACKEND = 'http://127.0.0.1:18200'

// ── Tests ────────────────────────────────────────────────────────

describe('ChatArea', () => {
  describe('empty state', () => {
    it('shows welcome message when no messages', () => {
      mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
      })
      render(<ChatArea backendUrl={BACKEND} />)
      expect(screen.getByText('Start a conversation')).toBeInTheDocument()
    })

    it('has a chat input', () => {
      mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
      })
      render(<ChatArea backendUrl={BACKEND} />)
      expect(screen.getByPlaceholderText('Ask about your knowledge base...')).toBeInTheDocument()
    })
  })

  describe('history loading', () => {
    it('renders loaded chat history', async () => {
      mockFetchResponses({
        '/chat/history': {
          messages: [
            { id: 1, role: 'user', content: 'Hello', sources: null, created_at: '2026-03-12T10:00:00' },
            { id: 2, role: 'assistant', content: 'Hi there!', sources: ['doc.md'], created_at: '2026-03-12T10:00:01' },
          ],
          total: 2,
        },
      })
      render(<ChatArea backendUrl={BACKEND} />)
      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeInTheDocument()
        expect(screen.getByText('Hi there!')).toBeInTheDocument()
      })
    })

    it('shows source citations for assistant messages', async () => {
      mockFetchResponses({
        '/chat/history': {
          messages: [
            { id: 1, role: 'assistant', content: 'Answer', sources: ['notes/readme.md', 'docs/guide.md'], created_at: '2026-03-12T10:00:00' },
          ],
          total: 1,
        },
      })
      render(<ChatArea backendUrl={BACKEND} />)
      await waitFor(() => {
        expect(screen.getByText('notes/readme.md')).toBeInTheDocument()
        expect(screen.getByText('docs/guide.md')).toBeInTheDocument()
      })
    })
  })

  describe('sending messages', () => {
    it('sends message on Enter key press', async () => {
      const fetchSpy = mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
        '/chat': ssePayload([
          { event: 'token', data: { token: 'Reply' } },
          { event: 'sources', data: { sources: [] } },
          { event: 'done', data: { status: 'complete' } },
        ]),
      })

      render(<ChatArea backendUrl={BACKEND} />)
      const input = screen.getByPlaceholderText('Ask about your knowledge base...')

      await typeAndSend(input, 'Test question')

      await waitFor(() => {
        const chatCalls = fetchSpy.mock.calls.filter(
          (c) => (c[0] as string).includes('/chat') && !(c[0] as string).includes('/history') && c[1]?.method === 'POST'
        )
        expect(chatCalls.length).toBe(1)
        const body = JSON.parse(chatCalls[0][1]!.body as string)
        expect(body.question).toBe('Test question')
      })
    })

    it('does not send on Shift+Enter (allows newline)', async () => {
      const fetchSpy = mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
      })

      render(<ChatArea backendUrl={BACKEND} />)
      const input = screen.getByPlaceholderText('Ask about your knowledge base...')

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Line 1' } })
      })
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

      const chatCalls = fetchSpy.mock.calls.filter(
        (c) => (c[0] as string).includes('/chat') && !(c[0] as string).includes('/history') && c[1]?.method === 'POST'
      )
      expect(chatCalls.length).toBe(0)
    })

    it('does not send empty messages', async () => {
      const fetchSpy = mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
      })

      render(<ChatArea backendUrl={BACKEND} />)
      const input = screen.getByPlaceholderText('Ask about your knowledge base...')

      fireEvent.keyDown(input, { key: 'Enter' })

      const chatCalls = fetchSpy.mock.calls.filter(
        (c) => (c[0] as string).includes('/chat') && !(c[0] as string).includes('/history') && c[1]?.method === 'POST'
      )
      expect(chatCalls.length).toBe(0)
    })

    it('clears input after sending', async () => {
      mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
        '/chat': ssePayload([
          { event: 'token', data: { token: 'OK' } },
          { event: 'sources', data: { sources: [] } },
          { event: 'done', data: { status: 'complete' } },
        ]),
      })

      render(<ChatArea backendUrl={BACKEND} />)
      const input = screen.getByPlaceholderText('Ask about your knowledge base...') as HTMLTextAreaElement

      await typeAndSend(input, 'Test')

      await waitFor(() => {
        expect(input.value).toBe('')
      })
    })

    it('shows user message immediately in chat', async () => {
      mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
        '/chat': ssePayload([
          { event: 'token', data: { token: 'Response' } },
          { event: 'sources', data: { sources: [] } },
          { event: 'done', data: { status: 'complete' } },
        ]),
      })

      render(<ChatArea backendUrl={BACKEND} />)
      const input = screen.getByPlaceholderText('Ask about your knowledge base...')

      await typeAndSend(input, 'My question')

      await waitFor(() => {
        expect(screen.getByText('My question')).toBeInTheDocument()
      })
    })
  })

  describe('SSE streaming', () => {
    it('displays streamed response tokens', async () => {
      mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
        '/chat': ssePayload([
          { event: 'token', data: { token: 'Hello ' } },
          { event: 'token', data: { token: 'world!' } },
          { event: 'sources', data: { sources: [] } },
          { event: 'done', data: { status: 'complete' } },
        ]),
      })

      render(<ChatArea backendUrl={BACKEND} />)
      const input = screen.getByPlaceholderText('Ask about your knowledge base...')

      await typeAndSend(input, 'Hi')

      await waitFor(() => {
        expect(screen.getByText('Hello world!')).toBeInTheDocument()
      })
    })

    it('displays source citations from SSE stream', async () => {
      mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
        '/chat': ssePayload([
          { event: 'token', data: { token: 'Answer' } },
          { event: 'sources', data: { sources: ['file1.md', 'file2.md'] } },
          { event: 'done', data: { status: 'complete' } },
        ]),
      })

      render(<ChatArea backendUrl={BACKEND} />)
      const input = screen.getByPlaceholderText('Ask about your knowledge base...')

      await typeAndSend(input, 'Question')

      await waitFor(() => {
        expect(screen.getByText('file1.md')).toBeInTheDocument()
        expect(screen.getByText('file2.md')).toBeInTheDocument()
      })
    })

    it('handles SSE error event', async () => {
      mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
        '/chat': ssePayload([
          { event: 'token', data: { token: 'Partial' } },
          { event: 'error', data: { error: 'LLM connection failed' } },
        ]),
      })

      render(<ChatArea backendUrl={BACKEND} />)
      const input = screen.getByPlaceholderText('Ask about your knowledge base...')

      await typeAndSend(input, 'Question')

      await waitFor(() => {
        expect(screen.getByText(/LLM connection failed/)).toBeInTheDocument()
      })
    })
  })

  describe('clear history', () => {
    it('has a clear history button when messages exist', async () => {
      mockFetchResponses({
        '/chat/history': {
          messages: [
            { id: 1, role: 'user', content: 'Hello', sources: null, created_at: '2026-03-12T10:00:00' },
          ],
          total: 1,
        },
      })

      render(<ChatArea backendUrl={BACKEND} />)
      await waitFor(() => {
        expect(screen.getByText('Clear history')).toBeInTheDocument()
      })
    })

    it('clears messages on clear history click', async () => {
      const fetchSpy = mockFetchResponses({
        '/chat/history': {
          messages: [
            { id: 1, role: 'user', content: 'Hello', sources: null, created_at: '2026-03-12T10:00:00' },
          ],
          total: 1,
        },
      })

      render(<ChatArea backendUrl={BACKEND} />)
      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeInTheDocument()
      })

      fetchSpy.mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url
        if (url.includes('/chat/history') && init?.method === 'DELETE') {
          return { ok: true, json: () => Promise.resolve({ deleted: 1 }) } as Response
        }
        if (url.includes('/chat/history')) {
          return { ok: true, json: () => Promise.resolve({ messages: [], total: 0 }) } as Response
        }
        return { ok: false, json: () => Promise.resolve({}) } as Response
      })

      await act(async () => {
        fireEvent.click(screen.getByText('Clear history'))
      })

      await waitFor(() => {
        expect(screen.getByText('Start a conversation')).toBeInTheDocument()
      })
    })
  })

  describe('send button', () => {
    it('has a send button that submits the message', async () => {
      const fetchSpy = mockFetchResponses({
        '/chat/history': { messages: [], total: 0 },
        '/chat': ssePayload([
          { event: 'token', data: { token: 'OK' } },
          { event: 'sources', data: { sources: [] } },
          { event: 'done', data: { status: 'complete' } },
        ]),
      })

      render(<ChatArea backendUrl={BACKEND} />)
      const input = screen.getByPlaceholderText('Ask about your knowledge base...')
      const sendBtn = screen.getByTestId('send-button')

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Question' } })
      })
      await act(async () => {
        fireEvent.click(sendBtn)
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })

      await waitFor(() => {
        const chatCalls = fetchSpy.mock.calls.filter(
          (c) => (c[0] as string).includes('/chat') && !(c[0] as string).includes('/history') && c[1]?.method === 'POST'
        )
        expect(chatCalls.length).toBe(1)
      })
    })
  })

  describe('message styling', () => {
    it('distinguishes user and assistant messages', async () => {
      mockFetchResponses({
        '/chat/history': {
          messages: [
            { id: 1, role: 'user', content: 'User msg', sources: null, created_at: '2026-03-12T10:00:00' },
            { id: 2, role: 'assistant', content: 'Bot msg', sources: null, created_at: '2026-03-12T10:00:01' },
          ],
          total: 2,
        },
      })

      render(<ChatArea backendUrl={BACKEND} />)
      await waitFor(() => {
        expect(screen.getByTestId('message-user-0')).toBeInTheDocument()
        expect(screen.getByTestId('message-assistant-1')).toBeInTheDocument()
      })
    })
  })
})
