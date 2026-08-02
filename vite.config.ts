import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        start_url: '/',
        // SVG icon is enough to install on Chrome/Android; add 192/512 PNG maskable icons at M8.
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
})
