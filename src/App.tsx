import { useEffect, useState } from 'react'
import AppLayout from './components/layout/AppLayout'
import OnboardingPage from './components/onboarding/OnboardingPage'
import DotGrid from './components/reactbits/DotGrid'
import { getBackendUrl } from './lib/platform'
import { initTheme } from './lib/theme'

// Apply the persisted (or system) theme before first paint — avoids a light flash.
initTheme()

export default function App() {
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:18200')
  const [firstRun, setFirstRun] = useState<boolean | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        const url = await getBackendUrl()
        setBackendUrl(url)
        // /health warms the connection check alongside the setup gate.
        const [, setupRes] = await Promise.all([
          fetch(`${url}/health`),
          fetch(`${url}/setup/status`),
        ])
        const setupData: { first_run?: boolean } = await setupRes.json()
        setFirstRun(setupData.first_run === true)
      } catch {
        setFirstRun(false)
      }
    }
    init()
  }, [])

  // Don't mount AppLayout until the setup check resolves — its children would fire
  // requests against the placeholder URL and the layout would flash before onboarding.
  let screen: React.ReactNode
  if (firstRun === null) {
    screen = (
      <div
        data-testid="app-connecting"
        className="flex h-screen items-center justify-center text-sm text-muted-foreground"
      >
        Connecting to backend…
      </div>
    )
  } else if (firstRun === true) {
    screen = <OnboardingPage backendUrl={backendUrl} onComplete={() => setFirstRun(false)} />
  } else {
    screen = <AppLayout backendUrl={backendUrl} />
  }

  return (
    <>
      {/* Global interactive background — content panels float above it (z-10). */}
      <div className="fixed inset-0 z-0 bg-background">
        <DotGrid />
      </div>
      <div className="relative z-10 h-screen">{screen}</div>
    </>
  )
}
