// Theme system: manual light/dark with persistence, falling back to the OS
// preference on first run. Pure functions take their dependencies (storage,
// root element) so the logic is testable without a browser.

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'knowhive-theme'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function getInitialTheme(storage: StorageLike, systemPrefersDark: boolean): Theme {
  const stored = storage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark ? 'dark' : 'light'
}

/** Tailwind darkMode:['class'] — the whole palette switches on this one class. */
export function applyTheme(theme: Theme, root: HTMLElement): void {
  root.classList.toggle('dark', theme === 'dark')
}

export function persistTheme(theme: Theme, storage: StorageLike): void {
  storage.setItem(THEME_STORAGE_KEY, theme)
}

/** Convenience for app code: resolve initial theme from real browser state. */
export function initTheme(): Theme {
  const theme = getInitialTheme(
    window.localStorage,
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  )
  applyTheme(theme, document.documentElement)
  return theme
}

/** Convenience for app code: apply + persist in one step. */
export function setTheme(theme: Theme): void {
  applyTheme(theme, document.documentElement)
  persistTheme(theme, window.localStorage)
}
