import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';
import { root, run, dockerExecutable } from '../audit/process.mjs';
import { fingerprint } from './state.mjs';

dotenv.config({ path: resolve(root, '.env'), quiet: true });
const sourceUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(sourceUrl.hostname) || sourceUrl.pathname !== '/firebridge') throw new Error('Expected the explicitly local firebridge source database.');
const suffix = new Date().toISOString().replace(/[^0-9]/g, '');
const cloneName = `firebridge_reconcile_${suffix}_test`;
const freshName = `firebridge_fresh_${suffix}_test`;
const directory = resolve(root, '.data/integration');
await mkdir(directory, { recursive: true });
const docker = dockerExecutable();
const source = new pg.Pool({ connectionString: sourceUrl.href });
const applied = (await source.query('SELECT migration_name,checksum FROM firebridge._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
if (applied.length !== 1 || applied[0].migration_name !== '20261030000000_firebridge_schema_v2' || applied[0].checksum !== '4aa08228ff22caf52441a5141f7dc6dfa681f27792d371466016f391ef0e9c25') throw new Error('Unrecognized migration history; no reconciliation attempted.');
const archive = `/tmp/firebridge-reconcile-${suffix}.dump`;
const localArchive = resolve(directory, `backup-${suffix}.dump`);
await run(docker, ['exec', 'firebridge-postgres', 'pg_dump', '-U', 'firebridge', '-d', 'firebridge', '-Fc', '-f', archive]);
await run(docker, ['cp', `firebridge-postgres:${archive}`, localArchive]);
const checksum = createHash('sha256').update(await readFile(localArchive)).digest('hex');
if ((await run(docker, ['exec', 'firebridge-postgres', 'sha256sum', archive])).stdout.split(/\s/)[0] !== checksum) throw new Error('Backup checksum mismatch.');
const list = (await run(docker, ['exec', 'firebridge-postgres', 'pg_restore', '--list', archive])).stdout;
const restoreList = resolve(directory, `restore-${suffix}.list`);
await writeFile(restoreList, list.split('\n').filter((line) => !/^\d+; 2615 \d+ SCHEMA - public /.test(line)).join('\n'));
await run(docker, ['cp', restoreList, `firebridge-postgres:/tmp/reconcile-${suffix}.list`]);
for (const name of [cloneName, freshName]) {
  if (!/^firebridge_[a-z0-9_]+_test$/.test(name)) throw new Error('Unsafe test database name.');
  await run(docker, ['exec', 'firebridge-postgres', 'createdb', '-U', 'firebridge', '-T', 'template0', name]);
}
await run(docker, ['exec', 'firebridge-postgres', 'pg_restore', '-U', 'firebridge', '--no-owner', '--no-acl', '--exit-on-error', `--use-list=/tmp/reconcile-${suffix}.list`, '-d', cloneName, archive]);
const urlFor = (name) => { const url = new URL(sourceUrl); url.pathname = '/' + name; return url.href; };
const clone = new pg.Pool({ connectionString: urlFor(cloneName) });
const fresh = new pg.Pool({ connectionString: urlFor(freshName) });
async function migrate(name, history) {
  if (!name.endsWith('_test')) throw new Error('Only isolated test databases can be migrated by this validator.');
  const migrationUrl = new URL(urlFor(name));
  migrationUrl.searchParams.set('schema', history === 'legacy' ? 'firebridge' : 'public');
  await run(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', resolve(root, 'packages/database/prisma.config.ts')], {
    env: { ...process.env, DATABASE_URL: migrationUrl.href, PRISMA_MIGRATION_HISTORY: history }, log: `reconcile-${history}-${suffix}.log`,
  });
}
try {
  const original = await fingerprint(source);
  if (JSON.stringify(original) !== JSON.stringify(await fingerprint(clone))) throw new Error('Restored backup does not match the source.');
  await migrate(cloneName, 'legacy');
  await migrate(freshName, 'shared');
  const after = await fingerprint(clone);
  for (const [name, before] of Object.entries(original)) if (JSON.stringify(before) !== JSON.stringify(after[name])) throw new Error('Existing rows changed: ' + name);
  const columnsSql = "SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema='firebridge' AND table_name NOT IN ('_prisma_migrations','spatial_ref_sys','geometry_columns','geography_columns') ORDER BY table_name,column_name";
  const cloneColumns = (await clone.query(columnsSql)).rows;
  const freshColumns = (await fresh.query(columnsSql)).rows;
  if (JSON.stringify(cloneColumns) !== JSON.stringify(freshColumns)) throw new Error('Legacy and shared application columns differ.');
  const constraintsSql = "SELECT c.relname AS table_name,con.contype,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='firebridge' AND c.relname NOT IN ('_prisma_migrations','spatial_ref_sys') ORDER BY c.relname,con.contype,pg_get_constraintdef(con.oid)";
  const legacyConstraints = (await clone.query(constraintsSql)).rows;
  const sharedConstraints = (await fresh.query(constraintsSql)).rows;
  // Shared history has extra source validation CHECKs; retain all legacy constraints.
  const missing = sharedConstraints.filter((c) => !(c.table_name === 'sources' && c.contype === 'c') && !legacyConstraints.some((l) => JSON.stringify(l) === JSON.stringify(c)));
  if (missing.length) throw new Error('Legacy schema lacks required constraints: ' + JSON.stringify(missing));
  if (JSON.stringify(original) !== JSON.stringify(await fingerprint(source))) throw new Error('Active database changed during validation.');
  const report = { validated_at: new Date().toISOString(), source_database_unchanged: true, source_fingerprint: original, backup: localArchive, backup_sha256: checksum, clone_database: cloneName, fresh_database: freshName, history: 'legacy', original_tables_preserved: Object.keys(original).length, application_columns_match: true, required_constraints_present: true, migrations: (await clone.query('SELECT migration_name,checksum FROM firebridge._prisma_migrations ORDER BY migration_name')).rows };
  await writeFile(resolve(directory, 'reconciliation-result.json'), JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ ...report, source_fingerprint: `${Object.keys(original).length} table fingerprints recorded locally` }, null, 2));
} finally { await Promise.all([source.end(), clone.end(), fresh.end()]); }
