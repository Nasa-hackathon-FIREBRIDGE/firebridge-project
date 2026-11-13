import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// Optional local-development proxy, e.g. FIREBRIDGE_API_PROXY=https://astramind.solutions
// together with VITE_API_URL=http://localhost:5173/api/v1. Never used by production builds.
const apiProxy = process.env.FIREBRIDGE_API_PROXY
// Optional: a locally running FIREBRIDGE API that serves the AI explainer routes, e.g.
// FIREBRIDGE_EXPLAINER_PROXY=http://localhost:3100 (the rest of /api/ still goes to apiProxy).
const explainerProxy = process.env.FIREBRIDGE_EXPLAINER_PROXY

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: apiProxy
    ? {
        proxy: {
          ...(explainerProxy ? { '^/api/v1/explainer/': { target: explainerProxy, changeOrigin: true } } : {}),
          '^/api/': { target: apiProxy, changeOrigin: true, secure: true },
        },
      }
    : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
