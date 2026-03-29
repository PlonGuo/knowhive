import { useEffect, useState } from 'react'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  size?: number
}

interface FileEntry {
  name: string
  path: string
}

interface KnowledgeOverviewProps {
  backendUrl: string
  onBack?: () => void
}

function flattenFiles(node: FileNode): FileEntry[] {
  if (node.type === 'file') return [{ name: node.name, path: node.path }]
  return (node.children ?? []).flatMap(flattenFiles)
}

export default function KnowledgeOverview({ backendUrl, onBack }: KnowledgeOverviewProps) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState<Record<string, boolean>>({})
  const [generateError, setGenerateError] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch(`${backendUrl}/knowledge/tree`)
      .then((r) => r.json())
      .then(async (tree: FileNode) => {
        const flat = flattenFiles(tree)
        setFiles(flat)
        setLoading(false)
        // Fetch all cached summaries in one batch request
        try {
          const resp = await fetch(`${backendUrl}/summary/cached`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_paths: flat.map((f) => f.path) }),
          })
          if (resp.ok) {
            const data: { file_path: string; summary: string }[] = await resp.json()
            const map: Record<string, string> = {}
            for (const item of data) {
              map[item.file_path] = item.summary
            }
            setSummaries(map)
          }
        } catch {
          // No cached summaries available — that's fine
        }
      })
      .catch(() => {
        setError('Failed to load knowledge files.')
        setLoading(false)
      })
  }, [backendUrl])

  const handleGenerate = async (filePath: string) => {
    setGenerating((prev) => ({ ...prev, [filePath]: true }))
    setGenerateError((prev) => ({ ...prev, [filePath]: '' }))
    try {
      const resp = await fetch(`${backendUrl}/summary/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: filePath }),
      })
      if (resp.ok) {
        const data = await resp.json()
        setSummaries((prev) => ({ ...prev, [filePath]: data.summary }))
      } else {
        const data = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
        setGenerateError((prev) => ({ ...prev, [filePath]: data.detail || `Error ${resp.status}` }))
      }
    } catch (e) {
      setGenerateError((prev) => ({ ...prev, [filePath]: e instanceof Error ? e.message : 'Network error' }))
    } finally {
      setGenerating((prev) => ({ ...prev, [filePath]: false }))
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <button
          data-testid="overview-back-button"
          onClick={onBack}
          className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          ← Back
        </button>
        <h1 className="text-xl font-semibold">Knowledge Overview</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <p className="text-center text-muted-foreground">Loading knowledge files...</p>}

        {error && <p className="text-center text-destructive">Error: {error}</p>}

        {!loading && !error && files.length === 0 && (
          <p data-testid="no-files-message" className="text-center text-muted-foreground">
            No files in knowledge base yet.
          </p>
        )}

        <div className="flex flex-col gap-3">
          {files.map((file) => (
            <div key={file.path} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{file.path}</p>
                </div>
                {!summaries[file.path] && (
                  <button
                    data-testid={`generate-summary-${file.path}`}
                    onClick={() => handleGenerate(file.path)}
                    disabled={generating[file.path]}
                    className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {generating[file.path] ? 'Generating...' : 'Generate Summary'}
                  </button>
                )}
              </div>

              {generateError[file.path] && (
                <p className="mt-2 text-xs text-destructive">{generateError[file.path]}</p>
              )}

              {summaries[file.path] && (
                <p className="mt-2 text-sm text-muted-foreground">{summaries[file.path]}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
