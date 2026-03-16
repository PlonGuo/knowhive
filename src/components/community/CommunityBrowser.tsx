import { useEffect, useState } from 'react'

interface ContentPack {
  id: string
  name: string
  description: string
  author: string
  tags: string[]
  file_count: number
  size_kb: number
  path: string
  imported: boolean
}

interface CommunityBrowserProps {
  backendUrl: string
  onBack?: () => void
}

export default function CommunityBrowser({ backendUrl, onBack }: CommunityBrowserProps) {
  const [packs, setPacks] = useState<ContentPack[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [importing, setImporting] = useState<Record<string, boolean>>({})
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    fetch(`${backendUrl}/community/packs`)
      .then((r) => r.json())
      .then((data: ContentPack[]) => {
        setPacks(data)
        setImportedIds(new Set(data.filter((p) => p.imported).map((p) => p.id)))
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load community packs. Please check your connection.')
        setLoading(false)
      })
  }, [backendUrl])

  const handleImport = async (packId: string) => {
    setImporting((prev) => ({ ...prev, [packId]: true }))
    try {
      await fetch(`${backendUrl}/community/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_id: packId }),
      })
      setImportedIds((prev) => new Set([...prev, packId]))
    } finally {
      setImporting((prev) => ({ ...prev, [packId]: false }))
    }
  }

  const filtered = packs.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
    )
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <button
          data-testid="community-back-button"
          onClick={onBack}
          className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          ← Back
        </button>
        <h1 className="text-xl font-semibold">Community Content</h1>
      </div>

      <div className="px-6 py-3 border-b">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search packs..."
          className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <p className="text-center text-muted-foreground">Loading community packs...</p>
        )}

        {error && (
          <p className="text-center text-destructive">Error: {error}</p>
        )}

        {!loading && !error && filtered.length === 0 && (
          <p className="text-center text-muted-foreground">No packs found.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((pack) => {
            const isImported = importedIds.has(pack.id)
            return (
              <div
                key={pack.id}
                className="rounded-lg border bg-card p-4 shadow-sm flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-sm">{pack.name}</h2>
                  {isImported ? (
                    <span
                      data-testid={`imported-badge-${pack.id}`}
                      className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                    >
                      Imported
                    </span>
                  ) : (
                    <button
                      data-testid={`import-pack-${pack.id}`}
                      onClick={() => handleImport(pack.id)}
                      disabled={importing[pack.id]}
                      className="shrink-0 rounded px-2 py-0.5 text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {importing[pack.id] ? 'Importing...' : 'Import'}
                    </button>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">{pack.description}</p>

                <div className="flex flex-wrap gap-1">
                  {pack.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  by {pack.author} · {pack.file_count} files · {pack.size_kb} KB
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
