import { useState } from 'react'
import Sidebar from './Sidebar'
import ChatArea from './ChatArea'
import StatusBar from './StatusBar'
import SettingsPage from '../settings/SettingsPage'
import MarkdownEditor from '../knowledge/MarkdownEditor'
import CommunityBrowser from '../community/CommunityBrowser'
import ReviewPage from '../review/ReviewPage'
import KnowledgeOverview from '../knowledge/KnowledgeOverview'

interface AppLayoutProps {
  health: { status: string; version: string } | null
  error: string | null
  backendUrl: string
}

export default function AppLayout({ health, error, backendUrl }: AppLayoutProps) {
  const [view, setView] = useState<'chat' | 'settings' | 'editor' | 'community' | 'review' | 'overview'>('chat')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [configVersion, setConfigVersion] = useState(0)

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
      {/* Floating panels over the DotGrid background: gap + padding lets it show through. */}
      <div className="flex flex-1 gap-3 overflow-hidden p-3">
        <Sidebar
          onSettingsClick={() => setView('settings')}
          onCommunityClick={() => setView('community')}
          onOverviewClick={() => setView('overview')}
          onFileSelect={handleFileSelect}
          selectedPath={selectedFilePath ?? undefined}
          backendUrl={backendUrl}
        />
        {/* Chat floats fully transparent over the dot grid; other views keep a card
            for readability until their own redesign pass. */}
        <div
          className={
            view === 'chat'
              ? 'flex flex-1 overflow-hidden'
              : 'flex flex-1 overflow-hidden rounded-xl border bg-background/75 shadow-sm backdrop-blur-md'
          }
        >
        {view === 'settings' ? (
          <SettingsPage backendUrl={backendUrl} onBack={() => setView('chat')} onConfigSaved={() => setConfigVersion((v) => v + 1)} />
        ) : view === 'community' ? (
          <CommunityBrowser backendUrl={backendUrl} onBack={() => setView('chat')} />
        ) : view === 'review' ? (
          <ReviewPage backendUrl={backendUrl} onBack={() => setView('chat')} />
        ) : view === 'overview' ? (
          <KnowledgeOverview backendUrl={backendUrl} onBack={() => setView('chat')} />
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
      </div>
      <StatusBar health={health} error={error} backendUrl={backendUrl} configVersion={configVersion} onReviewClick={() => setView("review")} />
    </div>
  )
}
