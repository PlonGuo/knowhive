import { useEffect, useState } from 'react'

/**
 * Shows when the watcher is re-indexing in the background.
 *
 * Measured (learnings/evals/Ingest-Chat-Concurrency.md): chat never fails during an
 * ingest, but latency roughly doubles, because ingest embeddings and chat generation
 * queue on the same Ollama runner. Unexplained 2x latency reads as "the app is broken",
 * so the fix is not to make it faster — it is to say what is happening.
 *
 * Deliberately renders nothing when idle: a permanent "watching" chip is noise, and the
 * only moment this information is worth screen space is the moment it explains a stall.
 */
export default function ReindexBadge({ backendUrl }: { backendUrl: string }) {
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = () =>
      fetch(`${backendUrl}/watcher/status`)
        .then((res) => (res.ok ? res.json() : null))
        .then((status: { syncing?: boolean } | null) => {
          if (!cancelled) setSyncing(Boolean(status?.syncing))
        })
        // A failed poll must not surface as "not syncing" noise or an error toast; the
        // badge is advisory, and the sidecar being unreachable is the status bar's job.
        .catch(() => {})
    poll()
    // 3s, not 10s: a sync that starts and ends between polls is exactly the one whose
    // slowdown the user felt and got no explanation for.
    const timer = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [backendUrl])

  if (!syncing) return null
  return (
    <span
      data-testid="reindex-badge"
      title="Files changed on disk, so the knowledge base is being re-indexed. Answers still work; they are just slower than usual while this runs (measured: about 2x)."
      className="rounded-full border bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm"
    >
      <span className="mr-1 inline-block animate-pulse">●</span>
      re-indexing
    </span>
  )
}
