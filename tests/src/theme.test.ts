// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { getInitialTheme, applyTheme, persistTheme, THEME_STORAGE_KEY } from '../../src/lib/theme'

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  }
}

describe('theme', () => {
  it('prefers the stored theme over the system preference', () => {
    expect(getInitialTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'light' }), true)).toBe('light')
    expect(getInitialTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }), false)).toBe('dark')
  })

  it('falls back to the system preference when nothing is stored', () => {
    expect(getInitialTheme(fakeStorage(), true)).toBe('dark')
    expect(getInitialTheme(fakeStorage(), false)).toBe('light')
  })

  it('ignores garbage in storage', () => {
    expect(getInitialTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'neon' }), true)).toBe('dark')
  })

  it('applyTheme toggles the dark class on the root element', () => {
    const root = document.createElement('html')
    applyTheme('dark', root)
    expect(root.classList.contains('dark')).toBe(true)
    applyTheme('light', root)
    expect(root.classList.contains('dark')).toBe(false)
  })

  it('persistTheme round-trips through getInitialTheme', () => {
    const storage = fakeStorage()
    persistTheme('dark', storage)
    expect(getInitialTheme(storage, false)).toBe('dark')
  })
})
