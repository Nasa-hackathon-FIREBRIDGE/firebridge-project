import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { auditDirectory, dockerExecutable, npmCommand, redact, root, run } from './process.mjs';
import { backupAndProvision, snapshot } from './safety.mjs';
import { smoke } from './smoke.mjs';
import { writeAuditReport } from './report.mjs';

const report = { started_at: new Date().toISOString(), original_services_replaced: false, commands: [], http: [], status: 'RUNNING' };
const suffix = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
async function npm(args, env, log, allowFailure = false) {
  console.info(`Running npm ${args.join(' ')}...`);
  const [cmd, ...prefix] = npmCommand();
  const result = await run(cmd, [...prefix, ...args], { env, log, allowFailure: true });
  report.commands.push({ command: `npm ${args.join(' ')}`, exit_code: result.code, log: `.data/audit/${log}` });
  const summary = result.stdout.match(/Tests\s+[^\r\n]+/g);
  if (summary) console.info(summary.join('\n'));
  if (result.code && !allowFailure) throw new Error(`npm ${args.join(' ')} failed (${result.code}). See .data/audit/${log}`);
  return result;
}

async function persistReport() {
  report.finished_at = new Date().toISOString();
  await writeAuditReport(report);
}

async function main() {
  if (process.argv.includes('--preview')) {
    console.info('Audit preview only: verify local Docker/DB -> backup+restore check -> isolated test DBs -> build/checks -> separate test containers on 3104 -> seed -> integration and HTTP/file checks -> report. Existing services and .env are preserved.');
    return;
  }
  if (process.argv.length > 2) throw new Error('Only --preview is supported; existing services are never replaced.');
  await mkdir(auditDirectory, { recursive: true });
  const configured = dotenv.parse(await readFile(resolve(root, '.env')));
  const originalUrl = new URL(configured.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(originalUrl.hostname) || originalUrl.pathname !== '/firebridge' || (process.env.NODE_ENV === 'production' || configured.NODE_ENV === 'production')) {
    throw new Error('This audit is restricted to the inspected local firebridge development database.');
  }
  const docker = dockerExecutable();
  const before = JSON.parse((await run(docker, ['inspect', 'firebridge-api', 'firebridge-worker', 'firebridge-postgres', 'firebridge-redis'])).stdout);
  const containers = before.map((container) => ({ id: container.Id, name: container.Name, image: container.Image,
    status: container.State.Status, health: container.State.Health?.Status, networks: Object.keys(container.NetworkSettings.Networks) }));
  await writeFile(resolve(auditDirectory, 'original-containers.json'), JSON.stringify(containers, null, 2));
  const network = containers.find((container) => container.name === '/firebridge-postgres').networks[0];
  console.info('Creating and fully restoring a backup before any fixture writes...');
  report.backup = await backupAndProvision(originalUrl.href, suffix);
  const fixtureDb = new URL(originalUrl); fixtureDb.pathname = '/firebridge_phase4_test'; fixtureDb.searchParams.set('schema', 'firebridge');
  const integrationDb = new URL(fixtureDb); integrationDb.pathname = '/firebridge_integration_test';
  const fixtureRedis = new URL(configured.REDIS_URL); fixtureRedis.pathname = '/15';
  const integrationRedis = new URL(fixtureRedis); integrationRedis.pathname = '/14';
  const fixtureEnv = { ...process.env, TEST_DATABASE_URL: fixtureDb.href, TEST_REDIS_URL: fixtureRedis.href };
  await npm(['run', 'build'], process.env, 'build.log');
  await npm(['run', 'typecheck'], process.env, 'typecheck.log');
  await npm(['run', 'lint'], process.env, 'lint.log');
  await npm(['test'], process.env, 'unit-tests.log');
  await npm(['run', 'seed:phase4', '--', '--apply', '--confirm-database', 'firebridge_phase4_test'], fixtureEnv, 'fixture.log');
  const containerDb = new URL(fixtureDb); containerDb.hostname = 'postgres'; containerDb.port = '5432';
  const dockerEnv = { ...process.env, FIREBRIDGE_TEST_DATABASE_URL: containerDb.href, FIREBRIDGE_DOCKER_NETWORK: network };
  console.info('Building only API/worker images; existing running containers stay unchanged...');
  await run(docker, ['compose', '-f', 'docker-compose.yml', 'build', 'api', 'worker'], { env: dockerEnv, log: 'docker-build-final.log' });
  await run(docker, ['compose', '--project-name', 'firebridgeaudit', '-f', 'docker-compose.audit.yml', 'up', '-d', 'api', 'worker'], { env: dockerEnv, log: 'docker-audit-start.log' });
  console.info('Waiting for isolated API and actual worker heartbeat...');
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = JSON.parse((await run(docker, ['inspect', 'firebridge-audit-api', 'firebridge-audit-worker'])).stdout);
    if (state.every((container) => container.State.Health?.Status === 'healthy')) { healthy = true; report.test_containers = state.map((c) => ({ name: c.Name, image: c.Image, health: c.State.Health.Status })); break; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  if (!healthy) throw new Error('Isolated container health failed. Inspect only firebridge-audit-api and firebridge-audit-worker logs.');
  const integration = await npm(['run', 'test:integration'], { ...process.env,
    TEST_DATABASE_URL: integrationDb.href, TEST_REDIS_URL: integrationRedis.href }, 'integration-final.log', true);
  report.integration_exit_code = integration.code;
  const exportRun = `audit_${suffix}`;
  await npm(['run', 'seed:phase4', '--', '--apply', '--confirm-database', 'firebridge_phase4_test', '--queue-exports', '--export-run', exportRun], fixtureEnv, 'fixture-exports.log');
  report.smoke_started_at = new Date().toISOString();
  report.http = await smoke({ databaseUrl: fixtureDb.href, redisUrl: fixtureRedis.href, exportRun });
  const baseline = JSON.parse(await readFile(resolve(auditDirectory, 'baseline.json')));
  const after = await snapshot(originalUrl.href);
  report.preservation = { unchanged: JSON.stringify(baseline) === JSON.stringify(after), tables: Object.keys(after).length,
    analyses: after.analyses.count, jobs: after.api_jobs.count };
  await writeFile(resolve(auditDirectory, 'after.json'), JSON.stringify(after, null, 2));
  const now = JSON.parse((await run(docker, ['inspect', ...containers.map((container) => container.name.slice(1))])).stdout);
  report.original_container_ids_unchanged = now.every((container, i) => container.Id === containers[i].id && container.Image === containers[i].image);
  report.status = integration.code === 0 && report.preservation.unchanged && report.original_container_ids_unchanged && report.http.every((row) => row.result === 'PASS') ? 'PASS' : 'FAIL';
  console.info(`Audit ${report.status}. HTTP: ${report.http.filter((row) => row.result === 'PASS').length}/${report.http.length}. Existing analyses preserved: ${after.analyses.count}.`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  report.status = 'BLOCKED'; report.error = redact(error.message); process.exitCode = 1; console.error(report.error);
}).finally(async () => {
  if (process.argv.includes('--preview')) return;
  try {
    if (report.smoke_started_at && !report.http.length) { try { report.http = JSON.parse(await readFile(resolve(auditDirectory, 'http-results.json'))); } catch { /* no smoke results yet */ } }
    await persistReport();
  } catch { console.error('Report could not be written. See .data/audit logs.'); process.exitCode = 1; }
});
