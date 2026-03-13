import { useState } from 'react'
import Sidebar from './Sidebar'
import ChatArea from './ChatArea'
import StatusBar from './StatusBar'
import SettingsPage from '../settings/SettingsPage'
import MarkdownEditor from '../knowledge/MarkdownEditor'

interface AppLayoutProps {
  health: { status: string; version: string } | null
  error: string | null
  backendUrl: string
}

export default function AppLayout({ health, error, backendUrl }: AppLayoutProps) {
  const [view, setView] = useState<'chat' | 'settings' | 'editor'>('chat')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)

  const handleFileSelect = (path: string) => {
    setSelectedFilePath(path)
    setView('editor')
  }

  const handleEditorClose = () => {
    setSelectedFilePath(null)
    setView('chat')
  }

  return (
    <div data-testid="app-layout" className="flex h-screen flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          onSettingsClick={() => setView('settings')}
          onFileSelect={handleFileSelect}
          selectedPath={selectedFilePath ?? undefined}
          backendUrl={backendUrl}
        />
        {view === 'settings' ? (
          <SettingsPage backendUrl={backendUrl} onBack={() => setView('chat')} />
        ) : view === 'editor' && selectedFilePath ? (
          <MarkdownEditor
            backendUrl={backendUrl}
            filePath={selectedFilePath}
            onClose={handleEditorClose}
          />
        ) : (
          <ChatArea backendUrl={backendUrl} />
        )}
      </div>
      <StatusBar health={health} error={error} backendUrl={backendUrl} />
    </div>
  )
}
