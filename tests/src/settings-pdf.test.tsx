// @vitest-environment happy-dom
// Settings → Retrieval → "PDF support": install the knowhive-pdf plugin
// (uv tool install + docling model prefetch) with the same download-to-enable
// affordance as the reranker card.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SettingsPage from '../../src/components/settings/SettingsPage'

const BACKEND = 'http://localhost:18234'

function mockFetch(opts: { pdfInstalled: boolean; installStatus?: string }) {
  const state = { installPosted: false }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/pdf/install-status')) {
      return {
        ok: true,
        json: () => Promise.resolve({ status: opts.installStatus ?? 'idle' }),
      } as Response
    }
    if (url.includes('/pdf/install')) {
      state.installPosted = true
      return { ok: true, json: () => Promise.resolve({ status: 'accepted' }) } as Response
    }
    if (url.includes('/pdf/status')) {
      return {
        ok: true,
        json: () =>
          Promise.resolve(
            opts.pdfInstalled
              ? { installed: true, plugin_version: '0.2.0', schema_version: 1 }
              : { installed: false },
          ),
      } as Response
    }
    if (url.includes('/reranker/status')) {
      return {
        ok: true,
        json: () => Promise.resolve({ available: true, model: 'x', size_mb: 1, downloaded: true, loaded: false }),
      } as Response
    }
    if (url.includes('/config')) {
      return { ok: true, json: () => Promise.resolve({ llm_provider: 'ollama' }) } as Response
    }
    return { ok: true, json: () => Promise.resolve({}) } as Response
  })
  return state
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Settings — PDF support card', () => {
  it('shows an install button when the plugin is missing', async () => {
    mockFetch({ pdfInstalled: false })
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.getByTestId('pdf-support-section')).toBeInTheDocument()
      expect(screen.getByTestId('install-pdf-button')).toBeInTheDocument()
    })
  })

  it('shows ready with the plugin version when installed', async () => {
    mockFetch({ pdfInstalled: true })
    render(<SettingsPage backendUrl={BACKEND} />)
    await waitFor(() => {
      expect(screen.getByTestId('pdf-ready-indicator')).toHaveTextContent('0.2.0')
    })
    expect(screen.queryByTestId('install-pdf-button')).toBeNull()
  })

  it('clicking install POSTs /pdf/install and reflects completion', async () => {
    const state = mockFetch({ pdfInstalled: false, installStatus: 'complete' })
    render(<SettingsPage backendUrl={BACKEND} />)
    const btn = await waitFor(() => screen.getByTestId('install-pdf-button'))
    fireEvent.click(btn)
    await waitFor(() => {
      expect(state.installPosted).toBe(true)
    })
  })
})
