/* eslint-env node */
import fs from 'fs'
import path from 'path'
import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

const DEV_NONCE = 'dev-nonce-123';
const certDir = path.resolve(process.cwd(), 'certs');
const devKeyPath = path.join(certDir, 'dev.key');
const devCertPath = path.join(certDir, 'dev.crt');
const hasCustomCert = fs.existsSync(devKeyPath) && fs.existsSync(devCertPath);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    basicSsl(),
    react({
      // Disable React Fast Refresh to avoid inline preamble in CSP-constrained dev contexts.
      fastRefresh: false,
    }),
    {
      name: 'dev-inline-nonce',
      enforce: 'post',
      transformIndexHtml(html) {
        return html.replace(/<script(?![^>]*nonce=)/g, `<script nonce="${DEV_NONCE}"`);
      },
    },
  ],
  server: {
    https: hasCustomCert
      ? {
          key: fs.readFileSync(devKeyPath),
          cert: fs.readFileSync(devCertPath),
        }
      : true,
    host: '0.0.0.0',
    port: 4173,
    hmr: false,
    // Dev-only permissive CSP to unblock HMR/preamble in browsers or extensions that inject stricter policies.
    // Do NOT mirror this header in production.
    headers: {
      "Content-Security-Policy":
        `default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; ` +
        `script-src * data: blob: 'unsafe-inline' 'unsafe-eval' 'nonce-${DEV_NONCE}'; ` +
        `style-src * data: blob: 'unsafe-inline'; ` +
        "img-src * data: blob:; connect-src *; frame-src *; object-src 'none';",
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    chunkSizeWarningLimit: 1024, // raise limit to 1 MB to avoid noisy warnings
  },
  optimizeDeps: {
    exclude: ['@avon_xyz/widget'],
  },
})
