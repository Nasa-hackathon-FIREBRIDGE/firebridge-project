import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { root, run } from '../audit/process.mjs';
import { fingerprint } from './state.mjs';
dotenv.config({ path: resolve(root, '.env'), quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/firebridge') throw new Error('Only the explicitly local firebridge database is supported.');
const report = JSON.parse(await readFile(resolve(root, '.data/integration/reconciliation-result.json'), 'utf8'));
if (!report.source_database_unchanged || !report.application_columns_match || !report.required_constraints_present || !report.source_fingerprint || Date.now() - Date.parse(report.validated_at) > 24 * 3600000) throw new Error('A recent successful isolated validation with recorded fingerprints is required.');
const backup = resolve(report.backup);
if (!backup.startsWith(resolve(root, '.data/integration') + '/') && !backup.startsWith(resolve(root, '.data/integration') + '\\')) throw new Error('Unexpected backup location.');
if (createHash('sha256').update(await readFile(backup)).digest('hex') !== report.backup_sha256) throw new Error('Verified backup changed.');
for (const { migration_name: name, checksum } of report.migrations) {
  if (!/^\d+_[a-z0-9_]+$/.test(name)) throw new Error('Invalid migration identifier.');
  const file = name === '20261030000000_firebridge_schema_v2' ? 'packages/database/prisma/sql/legacy_baseline_20261030000000.sql' : `packages/database/prisma/migrations/${name}/migration.sql`;
  if (createHash('sha256').update(await readFile(resolve(root, file))).digest('hex') !== checksum) throw new Error('Migration changed since isolated validation: ' + name);
}
const pool = new pg.Pool({ connectionString: url.href });
try {
  const applied = (await pool.query('SELECT migration_name,checksum FROM firebridge._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
  if (applied.length !== 1 || applied[0].migration_name !== '20261030000000_firebridge_schema_v2' || applied[0].checksum !== report.migrations[0].checksum) throw new Error('The active history changed; review it before applying.');
  if (JSON.stringify(await fingerprint(pool)) !== JSON.stringify(report.source_fingerprint)) throw new Error('The active data changed since backup validation. Take and validate a new backup.');
  await run(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', resolve(root, 'packages/database/prisma.config.ts')], { env: { ...process.env, PRISMA_MIGRATION_HISTORY: 'legacy' }, log: 'active-reconciliation.log' });
  const after = await fingerprint(pool);
  for (const [table, before] of Object.entries(report.source_fingerprint)) if (JSON.stringify(before) !== JSON.stringify(after[table])) throw new Error('Existing data changed unexpectedly: ' + table);
  const file = resolve(root, '.env'); let content = await readFile(file, 'utf8');
  content = /^PRISMA_MIGRATION_HISTORY=/m.test(content) ? content.replace(/^PRISMA_MIGRATION_HISTORY=.*$/m, 'PRISMA_MIGRATION_HISTORY=legacy') : content + '\nPRISMA_MIGRATION_HISTORY=legacy\n';
  await writeFile(file, content, { mode: 0o600 });
  const result = { applied_at: new Date().toISOString(), history: 'legacy', original_tables_preserved: Object.keys(report.source_fingerprint).length, all_original_rows_unchanged: true, backup_sha256: report.backup_sha256 };
  await writeFile(resolve(root, '.data/integration/applied-reconciliation.json'), JSON.stringify(result, null, 2));
  console.info(JSON.stringify(result, null, 2));
} finally { await pool.end(); }
