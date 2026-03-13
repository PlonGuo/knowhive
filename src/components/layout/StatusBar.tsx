import { useEffect, useRef, useState } from 'react'

interface WatcherStatus {
  running: boolean
  syncing: boolean
}

interface LlmConfig {
  llm_provider: string
  model_name: string
}

interface StatusBarProps {
  health: { status: string; version: string } | null
  error: string | null
  backendUrl?: string
  configVersion?: number
  onReviewClick?: () => void
}

export default function StatusBar({ health, error, backendUrl, configVersion, onReviewClick }: StatusBarProps) {
  const [watcher, setWatcher] = useState<WatcherStatus | null>(null)
  const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null)
  const [dueCount, setDueCount] = useState<number>(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchWatcherStatus = async () => {
    if (!backendUrl) return
    try {
      const res = await fetch(`${backendUrl}/watcher/status`)
      if (res.ok) {
        const data = await res.json()
        setWatcher({ running: data.running, syncing: data.syncing })
      }
    } catch {
      // silently ignore — watcher indicator just won't show
    }
  }

  const toggleWatcher = async () => {
    if (!backendUrl || !watcher) return
    try {
      const res = await fetch(`${backendUrl}/watcher/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !watcher.running }),
      })
      if (res.ok) {
        const data = await res.json()
        setWatcher({ running: data.running, syncing: data.syncing })
      }
    } catch {
      // ignore
    }
  }

  const fetchDueCount = async () => {
    if (!backendUrl) return
    try {
      const res = await fetch(`${backendUrl}/review/stats`)
      if (res.ok) {
        const data = await res.json()
        setDueCount(data.due_today ?? 0)
      }
    } catch {
      // silently ignore
    }
  }

  const fetchLlmConfig = async () => {
    if (!backendUrl) return
    try {
      const res = await fetch(`${backendUrl}/config`)
      if (res.ok) {
        const data = await res.json()
        setLlmConfig({ llm_provider: data.llm_provider, model_name: data.model_name })
      }
    } catch {
      // silently ignore
    }
  }

  useEffect(() => {
    if (!backendUrl) return
    fetchWatcherStatus()
    fetchLlmConfig()
    fetchDueCount()
    intervalRef.current = setInterval(fetchWatcherStatus, 10_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [backendUrl])

  useEffect(() => {
    fetchLlmConfig()
  }, [configVersion])

  let statusText: string
  let statusColor: string

  if (error) {
    statusText = 'Disconnected'
    statusColor = 'text-red-500'
  } else if (health) {
    statusText = `Backend: ${health.status} v${health.version}`
    statusColor = 'text-green-600'
  } else {
    statusText = 'Connecting...'
    statusColor = 'text-muted-foreground'
  }

  let watcherLabel: string | null = null
  let watcherColor = 'text-muted-foreground'
  if (watcher) {
    if (watcher.syncing) {
      watcherLabel = 'Syncing…'
      watcherColor = 'text-yellow-500'
    } else if (watcher.running) {
      watcherLabel = 'Watching'
      watcherColor = 'text-green-600'
    } else {
      watcherLabel = 'Watcher off'
      watcherColor = 'text-muted-foreground'
    }
  }

  return (
    <footer
      data-testid="status-bar"
      className="flex h-7 items-center justify-between border-t bg-secondary/50 px-4"
    >
      <span className={`text-xs ${statusColor}`}>{statusText}</span>
      {llmConfig && (
        <span data-testid="llm-indicator" className="text-xs text-muted-foreground">
          {llmConfig.llm_provider} / {llmConfig.model_name}
        </span>
      )}
      {dueCount > 0 && (
        <button
          data-testid="review-badge"
          onClick={onReviewClick}
          className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-orange-600 cursor-pointer"
        >
          {dueCount}
        </button>
      )}
      {watcherLabel && (
        <button
          data-testid="watcher-indicator"
          onClick={toggleWatcher}
          className={`text-xs cursor-pointer hover:underline ${watcherColor}`}
        >
          {watcherLabel}
        </button>
      )}
    </footer>
  )
}
