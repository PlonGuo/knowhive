import { useEffect, useState, useRef, useCallback } from 'react'
import FileTree from '../knowledge/FileTree'
import { selectFiles } from '../../lib/platform'
import { getInitialTheme, setTheme, type Theme } from '../../lib/theme'

interface ImportState {
  status: 'idle' | 'ingesting' | 'completed' | 'failed'
  totalFiles: number
  processedFiles: number
  error?: string
}

interface SidebarProps {
  onSettingsClick?: () => void
  onCommunityClick?: () => void
  onOverviewClick?: () => void
  onReviewClick?: () => void
  backendUrl?: string
  onFileSelect?: (path: string) => void
  selectedPath?: string
  onRefreshReady?: (refresh: () => void) => void
}

export default function Sidebar({
  onSettingsClick,
  onCommunityClick,
  onOverviewClick,
  onReviewClick,
  backendUrl,
  onFileSelect,
  selectedPath,
  onRefreshReady,
}: SidebarProps) {
  const [importState, setImportState] = useState<ImportState>({
    status: 'idle',
    totalFiles: 0,
    processedFiles: 0,
  })
  const [collapsed, setCollapsed] = useState(false)
  const [dueCount, setDueCount] = useState(0)
  const [theme, setThemeState] = useState<Theme>(() =>
    getInitialTheme(window.localStorage, window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false),
  )
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  useEffect(() => {
    if (!backendUrl) return
    fetch(`${backendUrl}/review/stats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setDueCount(data?.due_today ?? 0))
      .catch(() => {})
  }, [backendUrl])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const refreshTreeRef = useRef<(() => void) | null>(null)

  const handleRefreshReady = useCallback(
    (refresh: () => void) => {
      refreshTreeRef.current = refresh
      onRefreshReady?.(refresh)
    },
    [onRefreshReady],
  )

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const pollStatus = (taskId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${backendUrl}/ingest/status/${taskId}`)
        if (!res.ok) return
        const data = await res.json()
        setImportState({
          status: data.status === 'completed' ? 'completed' : data.status === 'failed' ? 'failed' : 'ingesting',
          totalFiles: data.total_files,
          processedFiles: data.processed_files,
          error: data.status === 'failed' ? (data.errors || 'Import failed') : undefined,
        })
        if (data.status === 'completed' || data.status === 'failed') {
          stopPolling()
          if (data.status === 'completed') {
            refreshTreeRef.current?.()
            setTimeout(() => setImportState({ status: 'idle', totalFiles: 0, processedFiles: 0 }), 2000)
          }
        }
      } catch {
        // Polling error — will retry on next interval
      }
    }, 500)
  }

  const handleImport = async () => {
    try {
      const files: string[] = await selectFiles()
      if (files.length === 0 || !backendUrl) return

      setImportState({ status: 'ingesting', totalFiles: files.length, processedFiles: 0 })

      const res = await fetch(`${backendUrl}/ingest/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_paths: files }),
      })

      if (!res.ok) {
        setImportState({ status: 'failed', totalFiles: files.length, processedFiles: 0, error: 'Failed to start import' })
        return
      }

      const data = await res.json()
      pollStatus(data.task_id)
    } catch {
      setImportState({ status: 'failed', totalFiles: 0, processedFiles: 0, error: 'Import cancelled or failed' })
    }
  }

  const progressPercent =
    importState.totalFiles > 0
      ? Math.round((importState.processedFiles / importState.totalFiles) * 100)
      : 0

  if (collapsed) {
    // Claude-style collapsed rail: just an expand handle below the traffic lights.
    return (
      <div data-testid="sidebar-rail" className="flex w-8 flex-col items-center pt-8">
        <button
          data-testid="sidebar-expand"
          onClick={() => setCollapsed(false)}
          aria-label="Expand sidebar"
          className="rounded-lg border bg-background/40 px-1.5 py-1 text-sm text-muted-foreground backdrop-blur-sm hover:bg-accent hover:text-accent-foreground"
        >
          »
        </button>
      </div>
    )
  }

  return (
    <aside
      data-testid="sidebar"
      className="flex w-64 flex-col overflow-hidden rounded-xl border bg-background/40 shadow-sm backdrop-blur-sm"
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Knowledge
        </div>
        <div className="flex items-center gap-1">
          <button
            data-testid="import-button"
            onClick={handleImport}
            disabled={importState.status === 'ingesting'}
            className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            {importState.status === 'ingesting' ? 'Importing...' : '+ Import'}
          </button>
          <button
            data-testid="sidebar-collapse"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            className="rounded px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            «
          </button>
        </div>
      </div>

      {importState.status !== 'idle' && (
        <div data-testid="import-progress" className="px-3 pb-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              data-testid="import-progress-bar"
              className={`h-full rounded-full transition-all ${
                importState.status === 'failed' ? 'bg-destructive' : importState.status === 'completed' ? 'bg-green-500' : 'bg-primary'
              }`}
              style={{ width: `${importState.status === 'completed' ? 100 : progressPercent}%` }}
            />
          </div>
          <p data-testid="import-status-text" className="mt-1 text-xs text-muted-foreground">
            {importState.status === 'ingesting' && `Importing ${importState.processedFiles}/${importState.totalFiles} files...`}
            {importState.status === 'completed' && 'Import complete!'}
            {importState.status === 'failed' && (importState.error || 'Import failed')}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-1 pb-3">
        {backendUrl ? (
          <FileTree
            backendUrl={backendUrl}
            onFileSelect={onFileSelect}
            selectedPath={selectedPath}
            onRefreshReady={handleRefreshReady}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No files imported yet</p>
        )}
      </div>

      <div className="border-t p-2 flex flex-col gap-1">
        <button
          data-testid="overview-button"
          onClick={onOverviewClick}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Overview
        </button>
        <button
          data-testid="community-button"
          onClick={onCommunityClick}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Community
        </button>
        <button
          data-testid="settings-button"
          onClick={onSettingsClick}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Settings
        </button>
        <div className="flex items-center justify-between px-1 pt-1">
          {dueCount > 0 ? (
            <button
              data-testid="review-badge"
              onClick={onReviewClick}
              className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {dueCount} due
            </button>
          ) : (
            <span />
          )}
          <button
            data-testid="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="rounded px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </div>
    </aside>
  )
}
