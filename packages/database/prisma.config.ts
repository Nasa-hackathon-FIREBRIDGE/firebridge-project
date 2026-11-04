import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig, env } from 'prisma/config';
import { mkdirSync, copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
dotenv.config({ path: rootEnvPath });

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const history = process.env.PRISMA_MIGRATION_HISTORY || 'shared';
if (!['shared', 'legacy'].includes(history)) throw new Error('PRISMA_MIGRATION_HISTORY must be shared or legacy.');
let migrationsPath = resolve(packageDirectory, 'prisma/migrations');
if (history === 'legacy') {
  // Retain the actual applied migration, never rewrite _prisma_migrations.
  const baseline = resolve(packageDirectory, 'prisma/sql/legacy_baseline_20261030000000.sql');
  if (createHash('sha256').update(readFileSync(baseline)).digest('hex') !== '4aa08228ff22caf52441a5141f7dc6dfa681f27792d371466016f391ef0e9c25') throw new Error('Legacy baseline checksum mismatch.');
  const additions = readdirSync(resolve(packageDirectory, 'prisma/migrations')).filter((name) => /^\d+_/.test(name) && name >= '20261101010000_');
  const fingerprint = createHash('sha256').update(additions.map((name) => name + readFileSync(resolve(packageDirectory, 'prisma/migrations', name, 'migration.sql'), 'utf8')).join('\n')).digest('hex').slice(0, 16);
  migrationsPath = resolve(packageDirectory, '../../.data/legacy-migrations', fingerprint);
  const original = resolve(migrationsPath, '20261030000000_firebridge_schema_v2');
  mkdirSync(original, { recursive: true });
  copyFileSync(baseline, resolve(original, 'migration.sql'));
  for (const name of readdirSync(resolve(packageDirectory, 'prisma/migrations'))) {
    if (!/^\d+_/.test(name) || name < '20261101010000_') continue;
    const target = resolve(migrationsPath, name);
    mkdirSync(target, { recursive: true });
    copyFileSync(resolve(packageDirectory, 'prisma/migrations', name, 'migration.sql'), resolve(target, 'migration.sql'));
  }
  copyFileSync(resolve(packageDirectory, 'prisma/migrations/migration_lock.toml'), resolve(migrationsPath, 'migration_lock.toml'));
}

const datasourceUrl = new URL(env('DATABASE_URL'));
if (history === 'legacy') datasourceUrl.searchParams.set('schema', 'firebridge');
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: migrationsPath
  },
  engine: 'classic',
  datasource: {
    url: datasourceUrl.href
  }
});
