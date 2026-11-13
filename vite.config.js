import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Security headers for the built site (Cloudflare reads dist/_headers). The browser may only load code from this site,
// talk to our Supabase project, and show images from this site, our storage, or photos made in the browser.
function securityHeaders() {
  let outDir = 'dist'
  let supabase = ''
  return {
    name: 'snapshotza-security-headers',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
      supabase = (loadEnv(config.mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL || '').replace(/\/$/, '')
    },
    closeBundle() {
      const host = supabase ? new URL(supabase).host : ''
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        `img-src 'self' data: blob:${host ? ` https://${host}` : ''}`,
        `connect-src 'self'${host ? ` https://${host} wss://${host}` : ''}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
      ].join('; ')
      const headers = `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin

/sw.js
  Cache-Control: no-cache
`
      fs.writeFileSync(path.resolve(outDir, '_headers'), headers)
    },
  }
}

export default defineConfig({
  plugins: [
    securityHeaders(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'SnapshotZA',
        short_name: 'SnapshotZA',
        description: 'Book verified photographers in South Africa with protected payments.',
        theme_color: '#0b0b0b',
        background_color: '#0b0b0b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is cached for offline/low-bandwidth use. API calls and photos are never cached here:
        // bookings, payments and chat must always be live.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin.includes('fonts.g'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts' },
          },
        ],
      },
    }),
  ],
  server: { host: true },
})
