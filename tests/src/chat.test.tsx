// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import ChatArea from '../../src/components/layout/ChatArea'

// ChatArea after the Phase C rewrite: useChat (AI SDK v7) over POST /chat with the
// UI-message stream protocol. Chat is stateless by design (no /chat/history).
// The mock stream below replicates the real wire format captured from the sidecar's
// toUIMessageStreamResponse (data: {"type":"start"} ... {"type":"finish"}).

const BACKEND = 'http://127.0.0.1:18200'

interface StreamOpts {
  deltas?: string[]
  sources?: string[]
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
}

function uiMessageStream({ deltas = ['hi'], sources = [], usage }: StreamOpts = {}): string {
  const meta = { sources }
  const chunks = [
    { type: 'start', messageMetadata: meta },
    { type: 'start-step' },
    { type: 'text-start', id: 'txt-0' },
    ...deltas.map((delta) => ({ type: 'text-delta', id: 'txt-0', delta })),
    { type: 'text-end', id: 'txt-0' },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop', messageMetadata: usage ? { ...meta, usage } : meta },
  ]
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

function mockChat(sse: string) {
  const calls: { url: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null })
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse))
        controller.close()
      },
    })
    return {
      ok: true,
      status: 200,
      body: stream,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as unknown as Response
  })
  return calls
}

async function typeAndSend(text: string) {
  const input = screen.getByPlaceholderText('Ask about your knowledge base...')
  await act(async () => {
    fireEvent.change(input, { target: { value: text } })
  })
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' })
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChatArea (useChat)', () => {
  it('shows the empty state before any messages', () => {
    render(<ChatArea backendUrl={BACKEND} />)
    expect(screen.getByTestId('chat-area')).toHaveTextContent('Start a conversation')
  })

  it('disables Send while the input is empty', () => {
    render(<ChatArea backendUrl={BACKEND} />)
    expect(screen.getByTestId('send-button')).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Ask about your knowledge base...'), {
      target: { value: 'hello' },
    })
    expect(screen.getByTestId('send-button')).not.toBeDisabled()
  })

  it('Enter POSTs the question to /chat as a UIMessage', async () => {
    const calls = mockChat(uiMessageStream())
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('what is RRF?')

    const chatCalls = calls.filter((c) => c.url.endsWith('/chat'))
    expect(chatCalls.length).toBe(1)
    expect(chatCalls[0]!.url).toBe(`${BACKEND}/chat`)
    const body = chatCalls[0]!.body as {
      messages: { role: string; parts: { type: string; text: string }[] }[]
    }
    expect(body.messages.at(-1)?.role).toBe('user')
    expect(body.messages.at(-1)?.parts[0]?.text).toBe('what is RRF?')
    expect(screen.getByTestId('message-user-0')).toHaveTextContent('what is RRF?')
  })

  it('reports finish-metadata usage through onUsage (feeds the sidebar meter)', async () => {
    mockChat(uiMessageStream({ usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 } }))
    const onUsage = vi.fn()
    render(<ChatArea backendUrl={BACKEND} onUsage={onUsage} />)
    await typeAndSend('hello')
    await waitFor(() => {
      expect(onUsage).toHaveBeenCalledWith({ inputTokens: 1200, outputTokens: 300, totalTokens: 1500 })
    })
  })

  it('renders streamed text deltas as the assistant message', async () => {
    mockChat(uiMessageStream({ deltas: ['RRF ', 'fuses ', 'rankings'] }))
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('explain')
    await waitFor(() => {
      expect(screen.getByTestId('message-assistant-1')).toHaveTextContent('RRF fuses rankings')
    })
  })

  it('renders source chips from message metadata', async () => {
    mockChat(uiMessageStream({ sources: ['knowledge/rrf.md', 'knowledge/hybrid.md'] }))
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('sources?')
    await waitFor(() => {
      const assistant = screen.getByTestId('message-assistant-1')
      expect(assistant).toHaveTextContent('Sources')
      // Chips show basenames (full paths are noisy in the UI)
      expect(assistant).toHaveTextContent('rrf.md')
      expect(assistant).toHaveTextContent('hybrid.md')
    })
  })

  it('shows an error message when the request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('backend down'))
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('hello?')
    await waitFor(() => {
      expect(screen.getByTestId('chat-area')).toHaveTextContent('backend down')
    })
  })

  it('styles user and assistant bubbles on opposite sides', async () => {
    mockChat(uiMessageStream())
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('hi')
    await waitFor(() => {
      expect(screen.getByTestId('message-user-0')).toHaveClass('justify-end')
      expect(screen.getByTestId('message-assistant-1')).toHaveClass('justify-start')
    })
  })

  it('clear history removes messages and returns to the empty state', async () => {
    mockChat(uiMessageStream())
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('hi')
    await waitFor(() => screen.getByText('Clear history'))

    fireEvent.click(screen.getByText('Clear history'))
    await waitFor(() => {
      expect(screen.getByTestId('chat-area')).toHaveTextContent('Start a conversation')
      expect(screen.queryByTestId('message-user-0')).not.toBeInTheDocument()
    })
  })
})

// --- Phase G: agent tool parts in the stream ---

function agenticStream({ sources = [] as string[], toolError = false } = {}): string {
  const meta = { sources }
  const toolStep = toolError
    ? [
        { type: 'tool-input-start', toolCallId: 'c1', toolName: 'search_knowledge' },
        { type: 'tool-input-available', toolCallId: 'c1', toolName: 'search_knowledge', input: { query: '区间DP' } },
        { type: 'tool-output-error', toolCallId: 'c1', errorText: 'ollama down' },
      ]
    : [
        { type: 'tool-input-start', toolCallId: 'c1', toolName: 'search_knowledge' },
        { type: 'tool-input-available', toolCallId: 'c1', toolName: 'search_knowledge', input: { query: '区间DP' } },
        { type: 'tool-output-available', toolCallId: 'c1', output: { results: [] } },
      ]
  const chunks = [
    { type: 'start', messageMetadata: meta },
    { type: 'start-step' },
    ...toolStep,
    { type: 'finish-step' },
    { type: 'start-step' },
    { type: 'text-start', id: 'txt-0' },
    { type: 'text-delta', id: 'txt-0', delta: 'final answer' },
    { type: 'text-end', id: 'txt-0' },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop', messageMetadata: meta },
  ]
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

describe('ChatArea agent tool parts', () => {
  it('renders a completed tool activity line with its query and the final answer', async () => {
    mockChat(agenticStream({ sources: ['a.md', 'b.md'] }))
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('对比两种DP')

    const tool = screen.getByTestId('tool-part-0')
    expect(tool).toHaveTextContent('Searching: 区间DP')
    expect(tool).toHaveAttribute('data-tool-status', 'done')
    expect(screen.getByTestId('chat-area')).toHaveTextContent('final answer')
    // aggregated sources still render as chips
    expect(screen.getByTestId('chat-area')).toHaveTextContent('a.md')
    expect(screen.getByTestId('chat-area')).toHaveTextContent('b.md')
  })

  it('renders tool errors as an error status line without breaking the answer', async () => {
    mockChat(agenticStream({ toolError: true }))
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('q')

    const tool = screen.getByTestId('tool-part-0')
    expect(tool).toHaveAttribute('data-tool-status', 'error')
    expect(tool).toHaveTextContent('ollama down')
    expect(screen.getByTestId('chat-area')).toHaveTextContent('final answer')
  })
})

describe('ChatArea approval flow (Phase H)', () => {
  function approvalStream(): string {
    const chunks = [
      { type: 'start' },
      { type: 'start-step' },
      { type: 'tool-input-start', toolCallId: 'wc1', toolName: 'create_note' },
      { type: 'tool-input-available', toolCallId: 'wc1', toolName: 'create_note', input: { path: 'a.md', content: 'hi' } },
      { type: 'tool-approval-request', approvalId: 'app1', toolCallId: 'wc1' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'tool-calls' },
    ]
    return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  }

  it('renders Allow/Deny for a pending write and resends on Allow', async () => {
    const calls = mockChat(approvalStream())
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('建个笔记')

    const tool = screen.getByTestId('tool-part-0')
    expect(tool).toHaveAttribute('data-tool-status', 'needs-approval')
    expect(tool).toHaveTextContent('Create note: a.md')

    await act(async () => {
      fireEvent.click(screen.getByTestId('tool-approve-0'))
      await new Promise((r) => setTimeout(r, 80))
    })
    // sendAutomaticallyWhen fires a second /chat POST carrying the approval
    expect(calls.filter((c) => c.url.endsWith('/chat')).length).toBeGreaterThanOrEqual(2)
    const second = calls.filter((c) => c.url.endsWith('/chat')).at(-1)!
    expect(JSON.stringify(second.body)).toContain('"approved":true')
  })
})

describe('stop button', () => {
  /** A stream that stays open until the test closes it, so `streaming` stays true. */
  function mockOpenStream() {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const enc = new TextEncoder()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
          // A real fetch rejects/cancels when its signal aborts; the mock has to
          // do the same or stop() looks like a no-op.
          init?.signal?.addEventListener('abort', () => {
            try {
              c.error(new DOMException('aborted', 'AbortError'))
            } catch {
              /* already closed */
            }
          })
          for (const chunk of [
            { type: 'start', messageMetadata: { sources: [] } },
            { type: 'start-step' },
            { type: 'text-start', id: 'txt-0' },
            { type: 'text-delta', id: 'txt-0', delta: 'partial' },
          ]) {
            c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          }
        },
      })
      return {
        ok: true,
        status: 200,
        body: stream,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
      } as unknown as Response
    })
    return {
      close: () => {
        try {
          controller?.close()
        } catch {
          /* already errored by the abort */
        }
      },
    }
  }

  afterEach(() => vi.restoreAllMocks())

  it('swaps send for stop while streaming, and back again after stopping', async () => {
    const open = mockOpenStream()
    render(<ChatArea backendUrl={BACKEND} />)
    expect(screen.getByTestId('send-button')).toBeInTheDocument()
    expect(screen.queryByTestId('stop-button')).toBeNull()

    await typeAndSend('a long question')
    const stop = await waitFor(() => screen.getByTestId('stop-button'))
    expect(screen.queryByTestId('send-button')).toBeNull()

    await act(async () => {
      fireEvent.click(stop)
    })
    await waitFor(() => expect(screen.getByTestId('send-button')).toBeInTheDocument())
    expect(screen.queryByTestId('stop-button')).toBeNull()
    open.close()
  })

  it('keeps the partial answer visible after stopping, so the turn is not lost', async () => {
    const open = mockOpenStream()
    render(<ChatArea backendUrl={BACKEND} />)
    await typeAndSend('a long question')
    const stop = await waitFor(() => screen.getByTestId('stop-button'))
    await waitFor(() => expect(screen.getByText(/partial/)).toBeInTheDocument())
    await act(async () => {
      fireEvent.click(stop)
    })
    expect(screen.getByText(/partial/)).toBeInTheDocument()
    open.close()
  })
})
