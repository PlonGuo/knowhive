import { useEffect, useRef, useState } from 'react'

interface WatcherStatus {
  running: boolean
  syncing: boolean
}

interface StatusBarProps {
  health: { status: string; version: string } | null
  error: string | null
  backendUrl?: string
}

export default function StatusBar({ health, error, backendUrl }: StatusBarProps) {
  const [watcher, setWatcher] = useState<WatcherStatus | null>(null)
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

  useEffect(() => {
    if (!backendUrl) return
    fetchWatcherStatus()
    intervalRef.current = setInterval(fetchWatcherStatus, 10_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [backendUrl])

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
