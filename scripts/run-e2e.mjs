import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const api = 'http://127.0.0.1:3301/api/v1'
// Never borrow the developer's .env credentials or target the deployed application.
const response = await fetch(api + '/catalog', { signal: AbortSignal.timeout(5000) })
const catalogue = (await response.json()).data
if (!response.ok || catalogue?.scope_key !== 'phase1_test' ||
    !catalogue.releases?.some((release) =>
      release.id === '22222222-2222-4222-8222-222222222222' && release.name.startsWith('TEST ONLY'))) {
  throw new Error('Start the isolated fixture API on port 3301 before browser tests. No mutation was sent.')
}
const env = { ...process.env, FIREBRIDGE_BROWSER_TEST: '1', VITE_API_URL: api }
const types = spawnSync(process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'e2e/tsconfig.json'],
  { cwd: root, env, stdio: 'inherit', windowsHide: true })
if (types.status !== 0) throw new Error('Browser-test type checking failed.')
mkdirSync(resolve(root, '.qa/e2e'), { recursive: true })
const build = spawnSync(process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', '--outDir', '.qa/e2e-dist'],
  { cwd: root, env, encoding: 'utf8', windowsHide: true })
writeFileSync(resolve(root, '.qa/e2e/build.log'), (build.stdout ?? '') + (build.stderr ?? ''))
if (build.status !== 0) throw new Error('Browser-test build failed. See .qa/e2e/build.log.')
const run = spawnSync(process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
  { cwd: root, env, stdio: 'inherit', windowsHide: true })
process.exitCode = run.status ?? 1
