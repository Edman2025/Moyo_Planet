import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4173'
const apiProxy = {
  target: apiProxyTarget,
  changeOrigin: true,
  timeout: 180_000,
  proxyTimeout: 180_000,
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiProxy,
      '/uploads': apiProxy,
      '/generated-pets': apiProxy,
    },
  },
})
