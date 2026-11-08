import pg from 'pg';
import { seedNativeResults } from '../../apps/api/tests/helpers/native-fixture.js';
import { ids } from '../../apps/api/tests/helpers/database.js';
const url = new URL(process.env.DATABASE_URL!);
const name = url.pathname.slice(1);
if (process.env.NODE_ENV !== 'test' || !/^firebridge_http_\d+_test$/.test(name)) throw new Error('Explicit fresh HTTP test database required.');
const pool = new pg.Pool({ connectionString: url.href });
try {
  if (Number((await pool.query('SELECT count(*) FROM firebridge.data_releases')).rows[0].count)) throw new Error('The HTTP test database must be empty before seeding.');
  await seedNativeResults(pool, name);
  // This is a TEST ONLY fixture, never published into the active database.
  await pool.query("UPDATE firebridge.data_releases SET status='retired' WHERE id<>$1::uuid", [ids.current]);
  console.info('Prepared explicitly synthetic TEST ONLY observations in the isolated HTTP test database.');
} finally { await pool.end(); }
