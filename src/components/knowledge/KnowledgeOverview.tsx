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

  useEffect(() => {
    fetch(`${backendUrl}/knowledge/tree`)
      .then((r) => r.json())
      .then((tree: FileNode) => {
        const flat = flattenFiles(tree)
        setFiles(flat)
        setLoading(false)
        // Fetch cached summaries for all files
        flat.forEach(async (f) => {
          try {
            const resp = await fetch(`${backendUrl}/summary/file?file_path=${encodeURIComponent(f.path)}`)
            if (resp.ok) {
              const data = await resp.json()
              setSummaries((prev) => ({ ...prev, [f.path]: data.summary }))
            }
          } catch {
            // No cached summary — that's fine
          }
        })
      })
      .catch(() => {
        setError('Failed to load knowledge files.')
        setLoading(false)
      })
  }, [backendUrl])

  const handleGenerate = async (filePath: string) => {
    setGenerating((prev) => ({ ...prev, [filePath]: true }))
    try {
      const resp = await fetch(`${backendUrl}/summary/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: filePath }),
      })
      if (resp.ok) {
        const data = await resp.json()
        setSummaries((prev) => ({ ...prev, [filePath]: data.summary }))
      }
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
