import { useEffect, useState } from 'react'

interface HealthStatus {
  status: string
  version: string
}

export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const backendUrl = window.api?.getBackendUrl?.() ?? 'http://127.0.0.1:8000'
    fetch(`${backendUrl}/health`)
      .then((r) => r.json())
      .then((data: HealthStatus) => setHealth(data))
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="rounded-lg border bg-card p-8 shadow-sm text-center space-y-4">
        <h1 className="text-2xl font-bold text-foreground">KnowHive</h1>
        <p className="text-sm text-muted-foreground">Local-first AI knowledge base</p>
        <div className="mt-4 rounded-md bg-muted p-4 text-left font-mono text-sm">
          {error ? (
            <span className="text-red-500">Backend unreachable: {error}</span>
          ) : health ? (
            <span className="text-green-600">
              Backend: {health.status} v{health.version}
            </span>
          ) : (
            <span className="text-muted-foreground">Connecting to backend...</span>
          )}
        </div>
      </div>
    </div>
  )
}
