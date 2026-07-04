import { useEffect, useState } from 'react'
import AppLayout from './components/layout/AppLayout'
import OnboardingPage from './components/onboarding/OnboardingPage'
import { getBackendUrl } from './lib/platform'

interface HealthStatus {
  status: string
  version: string
}

export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:18200')
  const [firstRun, setFirstRun] = useState<boolean | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        const url = await getBackendUrl()
        setBackendUrl(url)
        const [healthRes, setupRes] = await Promise.all([
          fetch(`${url}/health`),
          fetch(`${url}/setup/status`),
        ])
        const healthData: HealthStatus = await healthRes.json()
        const setupData: { first_run?: boolean } = await setupRes.json()
        setHealth(healthData)
        setFirstRun(setupData.first_run === true)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setFirstRun(false)
      }
    }
    init()
  }, [])

  // Don't mount AppLayout until the setup check resolves — its children would fire
  // requests against the placeholder URL and the layout would flash before onboarding.
  if (firstRun === null) {
    return (
      <div
        data-testid="app-connecting"
        className="flex h-screen items-center justify-center text-sm text-muted-foreground"
      >
        Connecting to backend…
      </div>
    )
  }

  if (firstRun === true) {
    return <OnboardingPage backendUrl={backendUrl} onComplete={() => setFirstRun(false)} />
  }

  return <AppLayout health={health} error={error} backendUrl={backendUrl} />
}
