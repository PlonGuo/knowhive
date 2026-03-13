import FileTree from '../knowledge/FileTree'

interface SidebarProps {
  onSettingsClick?: () => void
  backendUrl?: string
  onFileSelect?: (path: string) => void
  selectedPath?: string
  onRefreshReady?: (refresh: () => void) => void
}

export default function Sidebar({
  onSettingsClick,
  backendUrl,
  onFileSelect,
  selectedPath,
  onRefreshReady,
}: SidebarProps) {
  const handleImport = async () => {
    try {
      const files: string[] = await window.api.selectFiles()
      if (files.length > 0 && backendUrl) {
        await fetch(`${backendUrl}/ingest/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_paths: files }),
        })
      }
    } catch {
      // Import cancelled or failed — no-op
    }
  }

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
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          + Import
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-3">
        {backendUrl ? (
          <FileTree
            backendUrl={backendUrl}
            onFileSelect={onFileSelect}
            selectedPath={selectedPath}
            onRefreshReady={onRefreshReady}
          />
        ) : (
          <p className="px-2 text-sm text-muted-foreground">No files imported yet</p>
        )}
      </div>

      <div className="border-t p-2">
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
