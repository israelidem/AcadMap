import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { apiDevPlugin } from './scripts/api-dev-plugin';

export default defineConfig({
  plugins: [
    react(),
    // Runs the api/ functions on /api/* during development. No-op for builds.
    apiDevPlugin(),
    VitePWA({
      // Installable, offline-capable shell. The guest GPA calculator is pure
      // client-side maths, so it keeps working with no connection at all.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon-32.png', 'apple-touch-icon.png', 'logo.png'],

      manifest: {
        name: 'AcadMap — Your academic operating system',
        short_name: 'AcadMap',
        description:
          'GPA and CGPA tracking, academic records and an automatic study planner in one place.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        categories: ['education', 'productivity'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: "Today's plan", url: '/planner' },
          { name: 'GPA calculator', url: '/calculator' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Never let the service worker answer for the API or a share link:
        // stale academic data would be worse than an error message.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/share\//],
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: { port: 5173 },
});
