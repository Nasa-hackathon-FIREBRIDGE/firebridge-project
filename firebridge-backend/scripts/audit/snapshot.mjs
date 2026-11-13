import { createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';

const url = process.env.AUDIT_SNAPSHOT_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Snapshot requires an explicit local database.');
const client = new PrismaClient({ datasources: { db: { url } } });
try {
  const tables = await client.$queryRaw`SELECT relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='firebridge' AND c.relkind='r' AND relname <> 'spatial_ref_sys' ORDER BY relname`;
  const result = {};
  for (const { name } of tables) {
    if (!/^[a-z_]+$/.test(name)) throw new Error('Unexpected catalog identifier.');
    const rows = await client.$queryRaw(Prisma.sql`SELECT to_jsonb(t)::text AS row FROM ${Prisma.raw(`firebridge.${name}`)} t ORDER BY to_jsonb(t)::text`);
    result[name] = { count: rows.length, sha256: createHash('sha256').update(rows.map((row) => row.row).join('\n')).digest('hex') };
  }
  console.info(JSON.stringify(result));
} finally { await client.$disconnect(); }
