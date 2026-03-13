import { useState } from 'react'
import Sidebar from './Sidebar'
import ChatArea from './ChatArea'
import StatusBar from './StatusBar'
import SettingsPage from '../settings/SettingsPage'

interface AppLayoutProps {
  health: { status: string; version: string } | null
  error: string | null
  backendUrl: string
}

export default function AppLayout({ health, error, backendUrl }: AppLayoutProps) {
  const [view, setView] = useState<'chat' | 'settings'>('chat')

  return (
    <div data-testid="app-layout" className="flex h-screen flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          onSettingsClick={() => setView('settings')}
          backendUrl={backendUrl}
        />
        {view === 'settings' ? (
          <SettingsPage backendUrl={backendUrl} onBack={() => setView('chat')} />
        ) : (
          <ChatArea />
        )}
      </div>
      <StatusBar health={health} error={error} />
    </div>
  )
}
