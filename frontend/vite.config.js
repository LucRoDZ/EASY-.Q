import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',

      // Inject service worker registration into the app shell
      injectRegister: 'auto',

      manifest: {
        name: 'EASY.Q',
        short_name: 'EASY.Q',
        description: 'Menu digital QR — commandez et payez à table',
        theme_color: '#000000',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        orientation: 'portrait-primary',
        icons: [
          {
            src: 'pwa-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: 'pwa-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },

      workbox: {
        // Pre-cache all built assets (JS chunks, CSS, HTML)
        globPatterns: ['**/*.{js,css,html,svg,ico,woff,woff2}'],

        // Never cache API calls to non-public routes or auth routes
        navigateFallback: null,

        runtimeCaching: [
          // ── Public menu API — NetworkFirst, 5 min cache ────────────────
          {
            urlPattern: /\/api\/public\/menus\/.+/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'menu-api',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60, // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },

          // ── Static files in /storage (restaurant logos, PDFs) ─────────
          {
            urlPattern: /\/storage\/.+/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'storage-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },

          // ── Google Fonts (if ever used) ────────────────────────────────
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],

  build: {
    // Code splitting: vendor chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'react-vendor': ['react', 'react-dom'],
          // Router
          'router': ['react-router-dom'],
          // Stripe (large library — only needed on checkout pages)
          'stripe': ['@stripe/react-stripe-js', '@stripe/stripe-js'],
          // DnD kit (only needed in menu editor)
          'dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          // Icons
          'icons': ['lucide-react'],
        },
      },
    },
    // Warn when individual chunks exceed 500KB
    chunkSizeWarningLimit: 500,
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/storage': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
