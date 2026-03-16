import { useState, useEffect } from 'react'

interface MarkdownEditorProps {
  backendUrl: string
  filePath: string
  onClose?: () => void
}

export default function MarkdownEditor({ backendUrl, filePath, onClose }: MarkdownEditorProps) {
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFeedback, setSavedFeedback] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setSavedFeedback(false)

    fetch(`${backendUrl}/knowledge/file?path=${encodeURIComponent(filePath)}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || 'Failed to load file')
        }
        return res.json()
      })
      .then((data) => {
        setContent(data.content)
        setFileName(data.name)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Failed to load file')
        setLoading(false)
      })
  }, [backendUrl, filePath])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSavedFeedback(false)

    try {
      const res = await fetch(`${backendUrl}/knowledge/file/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || 'Failed to save file')
      } else {
        setSavedFeedback(true)
        setTimeout(() => setSavedFeedback(false), 2000)
      }
    } catch {
      setError('Failed to save file')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div data-testid="editor-loading" className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div data-testid="markdown-editor" className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span data-testid="editor-filename" className="text-sm font-medium text-foreground">
          {fileName}
        </span>
        <div className="flex items-center gap-2">
          {savedFeedback && (
            <span className="text-xs text-green-600">Saved</span>
          )}
          {error && (
            <span data-testid="editor-error" className="text-xs text-destructive">
              {error}
            </span>
          )}
          <button
            data-testid="editor-save-button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            data-testid="editor-cancel-button"
            onClick={onClose}
            className="rounded border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      </div>
      <textarea
        data-testid="editor-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="flex-1 resize-none bg-background p-4 font-mono text-sm text-foreground focus:outline-none"
        spellCheck={false}
      />
    </div>
  )
}
