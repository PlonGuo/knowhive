import { useState, useEffect, useRef, useCallback } from 'react'

interface ChatMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  sources?: string[] | null
  created_at?: string
}

interface ChatAreaProps {
  backendUrl?: string
}

// ── SSE parser ──────────────────────────────────────────────────

function parseSSE(text: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = []
  const blocks = text.split('\n\n')
  for (const block of blocks) {
    if (!block.trim()) continue
    let event = ''
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7)
      else if (line.startsWith('data: ')) data = line.slice(6)
    }
    if (event && data) events.push({ event, data })
  }
  return events
}

export default function ChatArea({ backendUrl }: ChatAreaProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamError])

  // Load chat history on mount
  useEffect(() => {
    if (!backendUrl) return
    fetch(`${backendUrl}/chat/history`)
      .then((r) => r.json())
      .then((data: { messages: ChatMessage[]; total: number }) => {
        if (data.messages) setMessages(data.messages)
      })
      .catch(() => {})
  }, [backendUrl])

  // Send message
  const sendMessage = useCallback(
    async (question: string) => {
      if (!backendUrl || !question.trim() || streaming) return

      const userMsg: ChatMessage = { role: 'user', content: question }
      setMessages((prev) => [...prev, userMsg])
      setInput('')
      setStreaming(true)
      setStreamError(null)

      // Add empty assistant message for streaming
      const assistantMsg: ChatMessage = { role: 'assistant', content: '', sources: null }
      setMessages((prev) => [...prev, assistantMsg])

      try {
        const res = await fetch(`${backendUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        })

        if (!res.ok || !res.body) {
          setStreamError('Failed to connect to chat service')
          setStreaming(false)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let fullContent = ''
        let sources: string[] = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const events = parseSSE(buffer)
          buffer = '' // Consumed

          for (const ev of events) {
            if (ev.event === 'token') {
              const { token } = JSON.parse(ev.data)
              fullContent += token
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullContent }
                return updated
              })
            } else if (ev.event === 'sources') {
              sources = JSON.parse(ev.data).sources
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = { ...updated[updated.length - 1], sources }
                return updated
              })
            } else if (ev.event === 'error') {
              const { error } = JSON.parse(ev.data)
              setStreamError(error)
            }
          }
        }
      } catch {
        setStreamError('Failed to connect to chat service')
      } finally {
        setStreaming(false)
      }
    },
    [backendUrl, streaming],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const handleClearHistory = async () => {
    if (!backendUrl) return
    try {
      await fetch(`${backendUrl}/chat/history`, { method: 'DELETE' })
      setMessages([])
    } catch {}
  }

  const hasMessages = messages.length > 0

  return (
    <main data-testid="chat-area" className="flex flex-1 flex-col bg-background">
      {/* Header with clear button */}
      {hasMessages && (
        <div className="flex items-center justify-end border-b px-4 py-2">
          <button
            onClick={handleClearHistory}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Clear history
          </button>
        </div>
      )}

      {/* Messages area */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {!hasMessages && !streaming ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="space-y-2 text-center">
              <p className="text-lg text-muted-foreground">Start a conversation</p>
              <p className="text-sm text-muted-foreground">Ask questions about your knowledge base</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-4 p-4">
            {messages.map((msg, i) => (
              <div
                key={msg.id ?? `msg-${i}`}
                data-testid={`message-${msg.role}-${i}`}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 border-t border-border/50 pt-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Sources:</p>
                      <div className="flex flex-wrap gap-1">
                        {msg.sources.map((src) => (
                          <span
                            key={src}
                            className="rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground"
                          >
                            {src}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {streamError && (
              <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {streamError}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your knowledge base..."
            rows={1}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={streaming}
          />
          <button
            data-testid="send-button"
            onClick={() => sendMessage(input)}
            disabled={streaming || !input.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </main>
  )
}
