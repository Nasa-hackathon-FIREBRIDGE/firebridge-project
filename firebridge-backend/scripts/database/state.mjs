import { createHash } from 'node:crypto';
export async function fingerprint(pool) {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='firebridge' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected table identifier.');
    const rows = (await pool.query(`SELECT to_jsonb(t)::text AS row FROM firebridge.${tablename} t ORDER BY to_jsonb(t)::text`)).rows;
    result[tablename] = { count: rows.length, sha256: createHash('sha256').update(rows.map((r) => r.row).join('\n')).digest('hex') };
  }
  return result;
}
