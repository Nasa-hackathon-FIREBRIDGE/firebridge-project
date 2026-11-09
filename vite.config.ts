import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// Optional local-development proxy, e.g. FIREBRIDGE_API_PROXY=https://astramind.solutions
// together with VITE_API_URL=http://localhost:5173/api/v1. Never used by production builds.
const apiProxy = process.env.FIREBRIDGE_API_PROXY

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: apiProxy ? { proxy: { '^/api/': { target: apiProxy, changeOrigin: true, secure: true } } } : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
