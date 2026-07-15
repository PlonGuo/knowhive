import { useState } from 'react'
import Sidebar from './Sidebar'
import ChatArea from './ChatArea'
import SettingsPage from '../settings/SettingsPage'
import MarkdownEditor from '../knowledge/MarkdownEditor'
import CommunityBrowser from '../community/CommunityBrowser'
import ReviewPage from '../review/ReviewPage'
import KnowledgeOverview from '../knowledge/KnowledgeOverview'

interface AppLayoutProps {
  backendUrl: string
}

export default function AppLayout({ backendUrl }: AppLayoutProps) {
  const [view, setView] = useState<'chat' | 'settings' | 'editor' | 'community' | 'review' | 'overview'>('chat')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionsVersion, setSessionsVersion] = useState(0)

  // Lazily create the conversation on first send — "+ New" just clears the active id.
  const ensureSession = async (): Promise<string> => {
    if (activeSessionId) return activeSessionId
    const res = await fetch(`${backendUrl}/sessions`, { method: 'POST' })
    const { id } = (await res.json()) as { id: string }
    setActiveSessionId(id)
    setSessionsVersion((v) => v + 1)
    return id
  }

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
      {/* Claude-desktop-style top strip: the native title bar is hidden, so this
          full-width gradient (background → transparent) is the window drag区, with
          the macOS traffic lights floating in its left edge. */}
      <div
        data-testid="drag-strip"
        data-tauri-drag-region
        className="h-9 w-full shrink-0 bg-gradient-to-b from-background via-background/70 to-transparent"
      />
      {/* Floating panels over the DotGrid background: gap + padding lets it show through. */}
      <div className="flex flex-1 gap-3 overflow-hidden px-3 pb-3">
        <Sidebar
          onSettingsClick={() => setView('settings')}
          onCommunityClick={() => setView('community')}
          onOverviewClick={() => setView('overview')}
          onReviewClick={() => setView('review')}
          onFileSelect={handleFileSelect}
          selectedPath={selectedFilePath ?? undefined}
          backendUrl={backendUrl}
          activeSessionId={activeSessionId}
          onSessionSelect={(id) => {
            setActiveSessionId(id)
            setView('chat')
          }}
          sessionsVersion={sessionsVersion}
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
          <SettingsPage backendUrl={backendUrl} onBack={() => setView('chat')} />
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
          <ChatArea
            backendUrl={backendUrl}
            sessionId={activeSessionId}
            ensureSession={ensureSession}
            onExchangeComplete={() => setSessionsVersion((v) => v + 1)}
          />
        )}
        </div>
      </div>
    </div>
  )
}
