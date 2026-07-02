// Frontend client for the sidecar's Ollama endpoints: status + streaming model pull.
// Shared by OnboardingPage and SettingsPage.

export interface RequiredModel {
  name: string
  purpose: 'chat' | 'embedding'
  installed: boolean
}

export interface OllamaStatus {
  running: boolean
  models: string[]
  required: RequiredModel[]
}

export async function fetchOllamaStatus(backendUrl: string): Promise<OllamaStatus> {
  const res = await fetch(`${backendUrl}/ollama/status`)
  if (!res.ok) throw new Error(`ollama status failed (${res.status})`)
  return res.json()
}

export interface PullResult {
  ok: boolean
  error?: string
}

/**
 * Pull a model through the sidecar's streaming proxy (POST /ollama/pull), reporting
 * progress as NDJSON events arrive. `onProgress` receives percent [0,100] and the
 * current Ollama status line.
 */
export async function pullModel(
  backendUrl: string,
  model: string,
  onProgress: (percent: number, status: string) => void,
): Promise<PullResult> {
  const res = await fetch(`${backendUrl}/ollama/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })
  if (!res.ok || !res.body) return { ok: false, error: `Pull failed (${res.status})` }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const evt = JSON.parse(line) as {
          status?: string
          error?: string
          total?: number
          completed?: number
        }
        if (evt.error) return { ok: false, error: evt.error }
        const percent = evt.total ? Math.round(((evt.completed ?? 0) / evt.total) * 100) : 0
        onProgress(percent, evt.status ?? '')
      } catch {
        // partial/malformed line — skip
      }
    }
  }
  onProgress(100, 'success')
  return { ok: true }
}
