import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai'
import FadeContent from '../reactbits/FadeContent'
import ShinyText from '../reactbits/ShinyText'
import { isToolPart, toolPartLabel, toolPartStatus, type ToolPartLike } from '../../lib/toolPart'

export interface ExchangeUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

interface ChatAreaProps {
  backendUrl?: string
  /** Active conversation (Phase M). Absent = legacy stateless chat. */
  sessionId?: string | null
  /** Create-or-return the active session id right before the first send. */
  ensureSession?: () => Promise<string>
  /** Fired when an exchange finishes streaming (lets the sidebar refresh titles). */
  onExchangeComplete?: () => void
  /** Fired once per exchange with the token usage the server put on finish metadata. */
  onUsage?: (usage: ExchangeUsage) => void
}

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:18200'

/** Retrieved source file paths, attached by the backend as message metadata. */
function messageSources(m: UIMessage): string[] {
  const meta = m.metadata as { sources?: string[] } | undefined
  return meta?.sources ?? []
}

/** One line of agent tool activity: spinner/✓/✗ + compact label; write tools that
 * need approval render Allow/Deny inline (Claude Code-style). */
function ToolActivity({
  part,
  index,
  onApproval,
}: {
  part: ToolPartLike
  index: number
  onApproval?: (id: string, approved: boolean) => void
}) {
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
      {status === 'denied' && (
        <>
          <span className="text-red-500">✗</span>
          <span className="line-through">{label}</span>
          <span>denied</span>
        </>
      )}
      {status === 'needs-approval' && (
        <>
          <span className="text-amber-500">⚠</span>
          <span className="font-medium text-foreground">{label}</span>
          <button
            data-testid={`tool-approve-${index}`}
            onClick={() => part.approval && onApproval?.(part.approval.id, true)}
            className="rounded-md border bg-primary px-2 py-0.5 text-primary-foreground hover:bg-primary/90"
          >
            Allow
          </button>
          <button
            data-testid={`tool-deny-${index}`}
            onClick={() => part.approval && onApproval?.(part.approval.id, false)}
            className="rounded-md border px-2 py-0.5 hover:bg-accent"
          >
            Deny
          </button>
        </>
      )}
    </div>
  )
}

export default function ChatArea({
  backendUrl,
  sessionId,
  ensureSession,
  onExchangeComplete,
  onUsage,
}: ChatAreaProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Agent mode is a per-conversation choice, so its toggle lives here in the
  // composer rather than in Settings. Toggling persists immediately — the next
  // /chat request reads the saved config.
  const [agentMode, setAgentMode] = useState(false)
  const configRef = useRef<Record<string, unknown> | null>(null)
  useEffect(() => {
    fetch(`${backendUrl ?? DEFAULT_BACKEND_URL}/config`)
      .then((r) => r.json())
      .then((cfg: { chat_mode?: string }) => {
        configRef.current = cfg as Record<string, unknown>
        setAgentMode(cfg.chat_mode === 'agentic')
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl])

  const toggleAgentMode = async () => {
    const next = !agentMode
    setAgentMode(next)
    const cfg = { ...(configRef.current ?? {}), chat_mode: next ? 'agentic' : 'single' }
    configRef.current = cfg
    await fetch(`${backendUrl ?? DEFAULT_BACKEND_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    }).catch(() => {})
  }

  // Recreate the transport if the (dynamically-resolved) backend URL changes.
  const transport = useMemo(
    () => new DefaultChatTransport({ api: `${backendUrl ?? DEFAULT_BACKEND_URL}/chat` }),
    [backendUrl],
  )

  const { messages, sendMessage, status, error, setMessages, addToolApprovalResponse } = useChat({
    transport,
    // After the user answers every pending Allow/Deny, resend automatically so the
    // server can resume (or skip) the gated tool call.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })
  const streaming = status === 'submitted' || status === 'streaming'

  const handleApproval = (id: string, approved: boolean) => {
    addToolApprovalResponse({ id, approved })
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, error])

  // Surface finish-metadata token usage exactly once per assistant message.
  const reportedUsageIds = useRef(new Set<string>())
  useEffect(() => {
    if (!onUsage) return
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.id || reportedUsageIds.current.has(m.id)) continue
      const usage = (m.metadata as { usage?: ExchangeUsage } | undefined)?.usage
      if (!usage) continue
      reportedUsageIds.current.add(m.id)
      onUsage(usage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // Session switch: load persisted history into the chat view.
  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      return
    }
    let cancelled = false
    fetch(`${backendUrl ?? DEFAULT_BACKEND_URL}/sessions/${sessionId}/messages`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then(({ messages: rows }: { messages: Array<{ id: number; role: 'user' | 'assistant'; content: string; sources: string[] }> }) => {
        if (cancelled) return
        setMessages(
          rows.map((r) => ({
            id: String(r.id),
            role: r.role,
            parts: [{ type: 'text' as const, text: r.content }],
            metadata: { sources: r.sources },
          })),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, backendUrl])

  // Notify once per finished exchange (title refresh in the sidebar).
  const prevStreaming = useRef(false)
  useEffect(() => {
    if (prevStreaming.current && !streaming) onExchangeComplete?.()
    prevStreaming.current = streaming
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming])

  const submit = async () => {
    if (!input.trim() || streaming) return
    const text = input
    setInput('')
    const sid = ensureSession ? await ensureSession() : sessionId ?? undefined
    sendMessage({ text }, sid ? { body: { session_id: sid } } : undefined)
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
        <div data-tauri-drag-region className="flex items-center justify-end px-4 py-2">
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
              <p className="font-serif text-2xl">
                <ShinyText text="Start a conversation" speed={4} />
              </p>
              <p className="text-sm text-muted-foreground">Ask questions about your knowledge base</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-6 py-4">
            {messages.map((msg, i) => {
              const sources = msg.role === 'assistant' ? messageSources(msg) : []
              return (
                <FadeContent
                  key={msg.id ?? `msg-${i}`}
                  testId={`message-${msg.role}-${i}`}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={
                      msg.role === 'user'
                        ? // Claude-style: user turns are compact rounded capsules…
                          'max-w-[75%] rounded-2xl border bg-secondary/80 px-4 py-2.5 text-secondary-foreground backdrop-blur-sm'
                        : // …assistant turns are plain prose straight on the background.
                          'max-w-full py-0.5 text-foreground'
                    }
                  >
                    {/* Render parts in order: agent tool activity interleaves with text.
                        Tool indexes count tool parts only (step-start parts render null). */}
                    {(() => {
                      let toolIdx = -1
                      return msg.parts.map((part, j) => {
                        if (part.type === 'text') {
                          return (
                            <div key={j} className="whitespace-pre-wrap text-sm leading-relaxed">
                              {(part as { text: string }).text}
                            </div>
                          )
                        }
                        if (isToolPart(part)) {
                          toolIdx += 1
                          return (
                            <ToolActivity key={j} part={part} index={toolIdx} onApproval={handleApproval} />
                          )
                        }
                        return null
                      })
                    })()}
                    {sources.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Sources</span>
                        {sources.map((src) => (
                          <span
                            key={src}
                            className="rounded-md border bg-accent/60 px-1.5 py-0.5 text-xs text-accent-foreground backdrop-blur-sm"
                          >
                            {src.split('/').pop()}
                          </span>
                        ))}
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

      {/* Floating composer card, Claude-style: textarea and send share one frame. */}
      <div className="px-6 pb-5 pt-2">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border bg-background/85 p-2 shadow-sm backdrop-blur-md focus-within:ring-1 focus-within:ring-ring">
          <button
            data-testid="chat-agent-toggle"
            onClick={toggleAgentMode}
            aria-pressed={agentMode}
            title={
              agentMode
                ? 'Agent mode on: the AI searches and reads notes on its own'
                : 'Agent mode off: single-shot answers from retrieved context'
            }
            className={`mb-0.5 shrink-0 rounded-xl border px-2.5 py-1 text-xs font-medium transition-colors ${
              agentMode
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            ⚡ Agent
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your knowledge base..."
            rows={1}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            disabled={streaming}
          />
          <button
            data-testid="send-button"
            onClick={submit}
            disabled={streaming || !input.trim()}
            className="rounded-xl bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            ↑
          </button>
        </div>
      </div>
    </main>
  )
}
