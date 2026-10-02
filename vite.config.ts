import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The service worker's filename is fixed by default ('sw.js'). The static host sits behind a
// CDN that edge-caches fixed URLs for hours and sends no cache headers of its own — so after a
// redeploy a browser's update check can keep receiving the OLD worker, leaving returning users
// (and the iPad home-screen app) on the previous build for up to four hours even though the new
// one is live. Stamping a per-build name makes every deploy a NEW URL: the edge misses it and
// the browser installs the new worker immediately. Scope is unchanged, so this still updates the
// SAME registration rather than creating a second one.
const buildId = Date.now().toString(36)
const SW_NAME = `sw-${buildId}.js`
const DIST_DIR = fileURLToPath(new URL('./dist', import.meta.url))

// Anyone who installed the app while the worker still had its fixed name holds a registration
// pointing at `sw.js`. If that URL stopped resolving, their browser's update check would fail
// forever and the installed worker would keep serving the previous build with no way forward — so
// the same worker is written to the legacy name as well. New pages register the content-addressed
// name and always fetch fresh bytes; existing installs still have a path to update.
function legacyWorkerName(): Plugin {
  return {
    name: 'minion:legacy-sw-name',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      copyFileSync(resolve(DIST_DIR, SW_NAME), resolve(DIST_DIR, 'sw.js'))
    },
  }
}

// Relative base so the build can be served from any path on any static server.
export default defineConfig({
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      filename: SW_NAME,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Minion — GM Companion',
        short_name: 'Minion',
        description: 'Author and run Pathfinder 2e and D&D 5e campaigns, offline.',
        theme_color: '#14110f',
        background_color: '#14110f',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,wasm,ttf,jpg,webp}'],
        // The legacy copy is for the service worker's OWN update path; precaching it would only
        // make the worker cache a redundant copy of itself.
        globIgnores: ['**/node_modules/**', 'sw.js'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
    legacyWorkerName(),
  ],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 4000 },
})
