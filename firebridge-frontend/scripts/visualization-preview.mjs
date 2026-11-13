import { spawn, spawnSync } from 'node:child_process'

// The browser test intercepts every API request with a controlled two-year fixture.
const env = { ...process.env, VITE_API_URL: 'http://127.0.0.1:5174/api/v1', FIREBRIDGE_API_PROXY: '', FIREBRIDGE_EXPLAINER_PROXY: '' }
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', '.qa/visualization-dist'], { env, stdio: 'inherit', windowsHide: true })
if (build.status !== 0) throw new Error('Visualization browser-test build failed.')
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5174', '--strictPort', '--outDir', '.qa/visualization-dist'], { env, stdio: 'inherit', windowsHide: true })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
server.on('error', (error) => { console.error(error); process.exitCode = 1 })
server.on('exit', (code) => { process.exitCode = code ?? 1 })
