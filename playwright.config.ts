import { defineConfig } from '@playwright/test'

if (process.env.FIREBRIDGE_BROWSER_TEST !== '1')
  throw new Error('Use npm run test:e2e with the isolated fixture API on port 3301.')

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: '.qa/e2e/artifacts',
  reporter: [['list'], ['json', { outputFile: '.qa/e2e/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1000 },
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5174 --strictPort --outDir .qa/e2e-dist',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 20_000,
  },
})
