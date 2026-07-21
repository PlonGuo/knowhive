import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone Vite config for the Tauri shell (coexists with electron-vite during migration).
// electron-vite uses electron.vite.config.ts; Vitest uses vitest.config.ts. This config is
// only consumed by `vite` / `vite build` driven by Tauri.
export default defineConfig({
  root: '.',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  // Tauri expects a fixed dev port and its own build output dir (dist/ and out/ are taken).
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true
  }
})
