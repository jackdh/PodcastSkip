import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.STORYBOOK ? [] : [VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Podflow — intelligent podcasts',
        short_name: 'Podflow',
        description: 'An intelligent, ad-aware podcast player.',
        theme_color: '#101827',
        background_color: '#101827',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname === '/api/audio',
          handler: 'CacheFirst',
          options: {
            cacheName: 'podflow-downloads-v1',
            expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
            cacheableResponse: { statuses: [0, 200] }
          }
        }]
      }
    })])
  ]
})
