import { useEffect, useState } from 'react'

// Codex-style session usage meter (sidebar, bottom-left). Two readings:
//  - cloud provider: cumulative token spend this session — the number you pay for.
//  - Ollama: how full the local model's context window is (last prompt tokens /
//    the model's context_length from /ollama/context). Spend is meaningless
//    locally; running out of context is the real budget.
export interface UsageStats {
  /** Sum of totalTokens across this session's exchanges. */
  sessionTokens: number
  /** inputTokens of the latest exchange — the prompt the model just saw. */
  lastInputTokens: number | null
}

interface UsageBadgeProps {
  backendUrl: string
  usage: UsageStats | null
}

const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export default function UsageBadge({ backendUrl, usage }: UsageBadgeProps) {
  const [provider, setProvider] = useState<string | null>(null)
  const [contextLength, setContextLength] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${backendUrl}/config`)
      .then((r) => r.json())
      .then((cfg: { llm_provider?: string }) => {
        if (cancelled) return
        setProvider(cfg.llm_provider ?? null)
        if (cfg.llm_provider === 'ollama') {
          fetch(`${backendUrl}/ollama/context`)
            .then((r) => r.json())
            .then((data: { context_length: number | null }) => {
              if (!cancelled) setContextLength(data.context_length)
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [backendUrl])

  if (!usage) return null

  const contextPct =
    provider === 'ollama' && contextLength && usage.lastInputTokens != null
      ? Math.min(100, Math.round((usage.lastInputTokens / contextLength) * 100))
      : null

  return (
    <span
      data-testid="usage-badge"
      title={
        contextPct != null
          ? `Local model context: ${usage.lastInputTokens} / ${contextLength} tokens used by the last request`
          : `Tokens used this session: ${usage.sessionTokens}`
      }
      className="rounded-full border bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm"
    >
      {contextPct != null ? `ctx ${contextPct}%` : `${formatTokens(usage.sessionTokens)} tokens`}
    </span>
  )
}
