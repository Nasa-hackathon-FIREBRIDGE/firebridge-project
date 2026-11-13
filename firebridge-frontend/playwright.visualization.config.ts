import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'visualization-responsive.e2e.ts',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  outputDir: '.qa/visualization/artifacts',
  reporter: [['list'], ['json', { outputFile: '.qa/visualization/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/visualization-preview.mjs',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
