import pg from 'pg';
import {
  seedContext,
  seedScientificContext,
  seedComparison,
  contextIds
} from './context-fixture.js';
import { nativeIds } from './native-fixture.js';
import { seedIngestion } from './ingestion-fixture.js';
const url = process.env.PHASE1_TEST_DATABASE_URL;
if (!url) throw new Error('Set PHASE1_TEST_DATABASE_URL to firebridge_phase1_test.');
const pool = new pg.Pool({ connectionString: url });
try {
  await seedContext(pool);
  await seedIngestion({ exec: (sql) => pool.query(sql) });
  await seedScientificContext(pool);
  await seedComparison(pool);
  console.log('TEST ONLY Phase 6 fixtures ready. No NASA/provider data downloaded.');
  console.log('native_analysis_id=' + nativeIds.analysis);
  console.log('prepared_science_analysis_id=' + contextIds.science);
  console.log('cell_id=6001');
} finally {
  await pool.end();
}
