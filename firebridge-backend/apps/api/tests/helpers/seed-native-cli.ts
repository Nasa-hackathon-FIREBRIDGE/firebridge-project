import pg from 'pg';
import { nativeIds, seedNativeResults } from './native-fixture.js';
const url = process.env.PHASE1_TEST_DATABASE_URL;
if (!url)
  throw new Error('Set PHASE1_TEST_DATABASE_URL to the migrated firebridge_phase1_test database.');
const pool = new pg.Pool({ connectionString: url });
try {
  await seedNativeResults(pool);
  console.log('Synthetic Phase 3 fixture ready in firebridge_phase1_test, scope phase1_test.');
  console.log('analysis_id=' + nativeIds.analysis);
} finally {
  await pool.end();
}
