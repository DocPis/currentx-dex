import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4173,
    // Allow Vite dev server to run under strict CSP contexts by enabling eval only in dev.
    // Do NOT mirror this header in production.
    headers: {
      "Content-Security-Policy": "script-src 'self' 'unsafe-eval'; object-src 'none';",
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    chunkSizeWarningLimit: 1024, // raise limit to 1 MB to avoid noisy warnings
  },
})
