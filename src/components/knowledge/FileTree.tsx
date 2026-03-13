import { useState, useEffect, useCallback } from 'react'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
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
  depth = 0,
}: {
  node: TreeNode
  onFileSelect?: (path: string) => void
  selectedPath?: string
  depth?: number
}) {
  const [expanded, setExpanded] = useState(true)
  const isDir = node.type === 'directory'
  const isSelected = !isDir && node.path === selectedPath

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
      >
        <span className="w-4 shrink-0 text-xs text-muted-foreground">
          {isDir ? (expanded ? '▼' : '▶') : ''}
        </span>
        <span className="truncate">{node.name}</span>
      </div>
      {isDir && expanded && node.children?.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          onFileSelect={onFileSelect}
          selectedPath={selectedPath}
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

  return (
    <div data-testid="filetree" className="text-sm">
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
          />
        ))
      ) : null}
    </div>
  )
}
