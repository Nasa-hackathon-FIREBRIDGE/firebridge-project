import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL) {
  throw new Error('Set TEST_DATABASE_URL (*_test) and TEST_REDIS_URL (DB 1-15).');
}
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const child = spawnSync(process.execPath, [npmCli, 'test'], {
  stdio: 'inherit', env: { ...process.env, RUN_INTEGRATION_TESTS: '1' }
});
process.exitCode = child.status ?? 1;
