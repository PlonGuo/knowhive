import { useState, useRef, useCallback } from 'react'
import FileTree from '../knowledge/FileTree'

interface ImportState {
  status: 'idle' | 'ingesting' | 'completed' | 'failed'
  totalFiles: number
  processedFiles: number
  error?: string
}

interface SidebarProps {
  onSettingsClick?: () => void
  onCommunityClick?: () => void
  backendUrl?: string
  onFileSelect?: (path: string) => void
  selectedPath?: string
  onRefreshReady?: (refresh: () => void) => void
}

export default function Sidebar({
  onSettingsClick,
  onCommunityClick,
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
      const files: string[] = await window.api.selectFiles()
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

  return (
    <aside
      data-testid="sidebar"
      className="flex w-64 flex-col border-r bg-secondary/50"
    >
      <div className="flex h-12 items-center gap-2 border-b px-4">
        <span className="text-lg font-bold text-foreground">KnowHive</span>
      </div>

      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Knowledge
        </div>
        <button
          data-testid="import-button"
          onClick={handleImport}
          disabled={importState.status === 'ingesting'}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          {importState.status === 'ingesting' ? 'Importing...' : '+ Import'}
        </button>
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
          <p className="px-2 text-sm text-muted-foreground">No files imported yet</p>
        )}
      </div>

      <div className="border-t p-2 flex flex-col gap-1">
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
      </div>
    </aside>
  )
}
