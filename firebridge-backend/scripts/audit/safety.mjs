import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { auditDirectory, dockerExecutable, root, run } from './process.mjs';

export async function snapshot(url) {
  // Windows keeps a loaded Prisma engine DLL locked until its process exits.
  // Snapshot in a short-lived child so subsequent prisma generate can replace it.
  const result = await run(process.execPath, [resolve(root, 'scripts/audit/snapshot.mjs')], {
    env: { ...process.env, AUDIT_SNAPSHOT_URL: url }
  });
  return JSON.parse(result.stdout);
}

export async function backupAndProvision(url, suffix) {
  const docker = dockerExecutable();
  const archive = `/tmp/firebridge-audit-${suffix}.dump`;
  await run(docker, ['exec', 'firebridge-postgres', 'pg_dump', '-U', 'firebridge', '-d', 'firebridge', '-Fc', '-f', archive]);
  const local = resolve(auditDirectory, `firebridge-${suffix}.dump`);
  await run(docker, ['cp', `firebridge-postgres:${archive}`, local]);
  const sha256 = createHash('sha256').update(await readFile(local)).digest('hex');
  const remote = await run(docker, ['exec', 'firebridge-postgres', 'sha256sum', archive]);
  if (remote.stdout.split(/\s/)[0] !== sha256) throw new Error('Backup checksum mismatch.');
  const list = await run(docker, ['exec', 'firebridge-postgres', 'pg_restore', '--list', archive]);
  // A fresh PostgreSQL database already has public. Skip only that CREATE SCHEMA;
  // never use --clean, DROP or a restore into the existing business database.
  const localList = resolve(auditDirectory, `restore-${suffix}.list`);
  await writeFile(localList, list.stdout.split('\n').filter((line) => !/^\d+; 2615 \d+ SCHEMA - public /.test(line)).join('\n'));
  await run(docker, ['cp', localList, `firebridge-postgres:/tmp/audit-${suffix}.list`]);
  const verifyName = `firebridge_backup_${suffix.toLowerCase()}_test`;
  if (!/^[a-z0-9_]+_test$/.test(verifyName)) throw new Error('Invalid backup verification name.');
  await run(docker, ['exec', 'firebridge-postgres', 'createdb', '-U', 'firebridge', '-T', 'template0', verifyName]);
  await run(docker, ['exec', 'firebridge-postgres', 'pg_restore', '-U', 'firebridge', '--no-owner', '--no-acl', '--exit-on-error',
    `--use-list=/tmp/audit-${suffix}.list`, '-d', verifyName, archive]);
  const cloneUrl = new URL(url); cloneUrl.pathname = `/${verifyName}`;
  const original = await snapshot(url), restored = await snapshot(cloneUrl.href);
  if (JSON.stringify(original) !== JSON.stringify(restored)) throw new Error('Restored backup differs from the preserved database.');
  for (const target of ['firebridge_phase4_test', 'firebridge_integration_test']) {
    const lookup = await run(docker, ['exec', 'firebridge-postgres', 'psql', '-U', 'firebridge', '-d', 'postgres', '-Atc', `SELECT datname FROM pg_database WHERE datname='${target}'`]);
    if (lookup.stdout.trim()) continue;
    await run(docker, ['exec', 'firebridge-postgres', 'createdb', '-U', 'firebridge', '-T', 'template0', target]);
    await run(docker, ['exec', 'firebridge-postgres', 'pg_restore', '-U', 'firebridge', '--schema-only', '--no-owner', '--no-acl', '--exit-on-error',
      `--use-list=/tmp/audit-${suffix}.list`, '-d', target, archive]);
  }
  await writeFile(resolve(auditDirectory, 'baseline.json'), JSON.stringify(original, null, 2));
  await copyFile(local, resolve(auditDirectory, 'latest-verified-backup.dump'));
  return { archive: local, sha256, restored_database: verifyName, preserved_tables: Object.keys(original).length,
    original_analyses: original.analyses.count, original_jobs: original.api_jobs.count };
}
