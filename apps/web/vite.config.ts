import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Dentro de Docker el API no está en localhost sino en el servicio `api`.
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
    hmr: process.env.VITE_DISABLE_HMR === '1' ? false : { host: 'localhost' },
    proxy: {
      '/api': proxyTarget,
      '/uploads': proxyTarget,
    },
  },
})
