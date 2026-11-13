import pg from 'pg';
import { seedNativeResults } from './native-fixture.js';
import { seedIngestion, ingestionIds } from './ingestion-fixture.js';

const url = process.env.PHASE1_TEST_DATABASE_URL;
if (!url) throw new Error('Set PHASE1_TEST_DATABASE_URL to firebridge_phase1_test.');
const pool = new pg.Pool({ connectionString: url });
try {
  // seedNativeResults verifies the actual database name before any mutation.
  await seedNativeResults(pool);
  await seedIngestion({ exec: (sql) => pool.query(sql) });
  console.log(
    'Synthetic Phase 1/3/5 fixtures ready in firebridge_phase1_test. No NASA data fetched.'
  );
  console.log('subscription_id=' + ingestionIds.subscription);
  console.log('fetch_run_id=' + ingestionIds.emptyRun);
} finally {
  await pool.end();
}
