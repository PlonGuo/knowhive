import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import FadeContent from '../reactbits/FadeContent'
import ShinyText from '../reactbits/ShinyText'
import { isToolPart, toolPartLabel, toolPartStatus, type ToolPartLike } from '../../lib/toolPart'

interface ChatAreaProps {
  backendUrl?: string
}

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:18200'

/** Retrieved source file paths, attached by the backend as message metadata. */
function messageSources(m: UIMessage): string[] {
  const meta = m.metadata as { sources?: string[] } | undefined
  return meta?.sources ?? []
}

/** One line of agent tool activity: spinner/✓/✗ + compact label. */
function ToolActivity({ part, index }: { part: ToolPartLike; index: number }) {
  const status = toolPartStatus(part)
  const label = toolPartLabel(part)
  return (
    <div
      data-testid={`tool-part-${index}`}
      data-tool-status={status}
      className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground"
    >
      {status === 'running' && (
        <>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
          <ShinyText text={label} />
        </>
      )}
      {status === 'done' && (
        <>
          <span className="text-green-600">✓</span>
          <span>{label}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <span className="text-red-500">✗</span>
          <span>
            {label}
            {part.errorText ? ` — ${part.errorText}` : ''}
          </span>
        </>
      )}
    </div>
  )
}

export default function ChatArea({ backendUrl }: ChatAreaProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Recreate the transport if the (dynamically-resolved) backend URL changes.
  const transport = useMemo(
    () => new DefaultChatTransport({ api: `${backendUrl ?? DEFAULT_BACKEND_URL}/chat` }),
    [backendUrl],
  )

  const { messages, sendMessage, status, error, setMessages } = useChat({ transport })
  const streaming = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, error])

  const submit = () => {
    if (!input.trim() || streaming) return
    sendMessage({ text: input })
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const hasMessages = messages.length > 0

  return (
    <main data-testid="chat-area" className="flex flex-1 flex-col bg-transparent">
      {hasMessages && (
        <div className="flex items-center justify-end border-b px-4 py-2">
          <button
            onClick={() => setMessages([])}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Clear history
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-y-auto">
        {!hasMessages && !streaming ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="space-y-2 text-center">
              <p className="text-lg">
                <ShinyText text="Start a conversation" speed={4} />
              </p>
              <p className="text-sm text-muted-foreground">Ask questions about your knowledge base</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-4 p-4">
            {messages.map((msg, i) => {
              const sources = msg.role === 'assistant' ? messageSources(msg) : []
              return (
                <FadeContent
                  key={msg.id ?? `msg-${i}`}
                  testId={`message-${msg.role}-${i}`}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {/* Render parts in order: agent tool activity interleaves with text.
                        Tool indexes count tool parts only (step-start parts render null). */}
                    {(() => {
                      let toolIdx = -1
                      return msg.parts.map((part, j) => {
                        if (part.type === 'text') {
                          return (
                            <div key={j} className="whitespace-pre-wrap text-sm">
                              {(part as { text: string }).text}
                            </div>
                          )
                        }
                        if (isToolPart(part)) {
                          toolIdx += 1
                          return <ToolActivity key={j} part={part} index={toolIdx} />
                        }
                        return null
                      })
                    })()}
                    {sources.length > 0 && (
                      <div className="mt-2 border-t border-border/50 pt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Sources:</p>
                        <div className="flex flex-wrap gap-1">
                          {sources.map((src) => (
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
                </FadeContent>
              )
            })}
            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {error.message || 'Failed to connect to chat service'}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

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
            onClick={submit}
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
