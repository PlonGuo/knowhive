import { useState, useEffect, useCallback, useRef } from 'react'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
}

interface ContextMenuState {
  x: number
  y: number
  node: TreeNode
}

interface FileTreeProps {
  backendUrl: string
  onFileSelect?: (path: string) => void
  selectedPath?: string
  onRefreshReady?: (refresh: () => void) => void
}

function TreeItem({
  node,
  onFileSelect,
  selectedPath,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onContextMenu,
  depth = 0,
}: {
  node: TreeNode
  onFileSelect?: (path: string) => void
  selectedPath?: string
  renamingPath?: string | null
  renameValue?: string
  onRenameChange?: (value: string) => void
  onRenameSubmit?: () => void
  onRenameCancel?: () => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState(true)
  const isDir = node.type === 'directory'
  const isSelected = !isDir && node.path === selectedPath
  const isRenaming = node.path === renamingPath

  return (
    <div>
      <div
        data-testid="filetree-item"
        className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm ${
          isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (isDir) {
            setExpanded(!expanded)
          } else {
            onFileSelect?.(node.path)
          }
        }}
        onContextMenu={(e) => {
          if (!isDir) {
            e.preventDefault()
            onContextMenu?.(e, node)
          }
        }}
      >
        <span className="w-4 shrink-0 text-xs text-muted-foreground">
          {isDir ? (expanded ? '▼' : '▶') : ''}
        </span>
        {isRenaming ? (
          <input
            data-testid="rename-input"
            className="min-w-0 flex-1 rounded border border-input bg-background px-1 text-sm"
            value={renameValue}
            onChange={(e) => onRenameChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit?.()
              if (e.key === 'Escape') onRenameCancel?.()
            }}
            onBlur={() => onRenameCancel?.()}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </div>
      {isDir && expanded && node.children?.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          onFileSelect={onFileSelect}
          selectedPath={selectedPath}
          renamingPath={renamingPath}
          renameValue={renameValue}
          onRenameChange={onRenameChange}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          onContextMenu={onContextMenu}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

export default function FileTree({
  backendUrl,
  onFileSelect,
  selectedPath,
  onRefreshReady,
}: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [error, setError] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const fetchTree = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/knowledge/tree`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setTree(data)
      setError(false)
    } catch {
      setError(true)
    }
  }, [backendUrl])

  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  useEffect(() => {
    onRefreshReady?.(fetchTree)
  }, [onRefreshReady, fetchTree])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [contextMenu])

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return
    const { node } = contextMenu
    setContextMenu(null)

    if (!confirm(`Delete "${node.name}"?`)) return

    try {
      await fetch(`${backendUrl}/knowledge/file?path=${encodeURIComponent(node.path)}`, {
        method: 'DELETE',
      })
      fetchTree()
    } catch {
      // silently fail — tree stays as-is
    }
  }, [contextMenu, backendUrl, fetchTree])

  const handleRenameStart = useCallback(() => {
    if (!contextMenu) return
    const { node } = contextMenu
    setContextMenu(null)
    setRenamingPath(node.path)
    setRenameValue(node.name)
  }, [contextMenu])

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPath) return
    const oldName = renamingPath.split('/').pop() || ''
    const newName = renameValue.trim()
    setRenamingPath(null)

    if (!newName || newName === oldName) return

    // Build new_path by replacing filename in the path
    const dir = renamingPath.includes('/')
      ? renamingPath.substring(0, renamingPath.lastIndexOf('/') + 1)
      : ''
    const newPath = dir + newName

    try {
      await fetch(`${backendUrl}/knowledge/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_path: renamingPath, new_path: newPath }),
      })
      fetchTree()
    } catch {
      // silently fail
    }
  }, [renamingPath, renameValue, backendUrl, fetchTree])

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null)
  }, [])

  return (
    <div data-testid="filetree" className="relative text-sm">
      {error ? (
        <p className="px-2 text-sm text-destructive">Failed to load files</p>
      ) : tree && tree.children && tree.children.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files imported yet</p>
      ) : tree ? (
        tree.children?.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            onFileSelect={onFileSelect}
            selectedPath={selectedPath}
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={handleRenameCancel}
            onContextMenu={handleContextMenu}
          />
        ))
      ) : null}

      {contextMenu && (
        <div
          ref={menuRef}
          data-testid="context-menu"
          className="fixed z-50 min-w-[120px] rounded-md border bg-popover p-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
            onClick={handleRenameStart}
          >
            Rename
          </button>
          <button
            className="w-full rounded-sm px-2 py-1 text-left text-sm text-destructive hover:bg-accent"
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
