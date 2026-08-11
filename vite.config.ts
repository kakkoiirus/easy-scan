import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command, isPreview }) => ({
  // Pages serves the app at a project subpath
  // (kakkoiirus.github.io/easy-scan/, ADR-0004). The production build and its
  // preview use that base; the dev server stays at the root for a clean
  // localhost:5173/.
  base: command === 'serve' && !isPreview ? '/' : '/easy-scan/',
  plugins: [
    react(),
    VitePWA({
      // `prompt` (not `autoUpdate`): the waiting service worker is NOT
      // auto-activated, so a deploy never silently reloads under the user (or
      // mid-scan). Instead the update prompt surfaces the waiting SW and the
      // reload is driven by the user's choice (see .scratch/app-update/spec.md).
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // The CV worker bundles OpenCV.js inline (~16 MB, embedded wasm — no
        // separate asset, no CDN). Precache it so the scanner works offline
        // (ADR-0001). Well above the Workbox 2 MiB default.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
      manifest: {
        name: 'Easy-scan',
        short_name: 'Easy-scan',
        description: 'Сканер документов прямо в браузере',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'portrait',
        // Relative so they resolve against the manifest's own URL — correct
        // under both dev (base '/') and the Pages subpath (base '/easy-scan/',
        // ADR-0004). `id` keeps the install identity stable across base changes.
        id: 'easy-scan',
        start_url: '.',
        scope: '.',
        // SVG icon is enough to install on Chrome/Android; add 192/512 PNG maskable icons at M8.
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
}))
