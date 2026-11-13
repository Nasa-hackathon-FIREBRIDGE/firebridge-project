export const ingestionIds = {
  subscription: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  emptyRun: 'f5000000-0000-4000-8000-000000000001',
  failedRun: 'f5000000-0000-4000-8000-000000000002',
  terraGap: 'f5000000-0000-4000-8000-000000000003',
  aquaGap: 'f5000000-0000-4000-8000-000000000004'
};
export const adminToken = 'test-only-ingestion-admin-token-at-least-32-characters';
export const backfillBody = {
  feed_id: 'modis',
  area_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scope_key: 'phase1_test',
  start: '2024-01-17T00:00:00Z',
  end_exclusive: '2024-01-20T00:00:00Z',
  source_ids: ['terra', 'aqua'],
  products: ['MCD14ML'],
  collection: '6.1',
  resource_budget: { max_chunks: 3, max_bytes: 1000000 }
};
/** Only call after the guarded base fixture has initialized its test database. */
export async function seedIngestion(db: { exec(sql: string): Promise<unknown> }) {
  await db.exec(`
    DELETE FROM firebridge.outbox_events;
    UPDATE firebridge.ingestion_feeds SET credential_ref='env:INGESTION_TEST_ONLY_MISSING_KEY',
      capability_spec='{"ingestion_v1":{"max_chunk_seconds":86400,"max_window_seconds":31622400,"query_basis":"observation_time"}}'
      WHERE id='modis';
    UPDATE firebridge.ingestion_subscriptions SET interval_seconds=3600,request_config='{
      "source_ids":["aqua","terra"],"products":["MCD14ML"],"collection":"6.1",
      "adapter":"adapter","adapter_version":"1"}' WHERE id='${ingestionIds.subscription}';
    INSERT INTO firebridge.fetch_runs
      (id,subscription_id,request_key,attempt,query_start,query_end_exclusive,query_basis,sanitized_request,
       status,enumeration_complete,page_count,record_count,started_at,completed_at,max_observation_at,error_code)
    VALUES
      ('${ingestionIds.emptyRun}','${ingestionIds.subscription}','empty',1,'2024-01-17Z','2024-01-18Z',
        'observation_time','{"url":"https://private/MAP_KEY/token","headers":{"Authorization":"Bearer secret"}}',
        'complete',true,1,0,now()-interval '1 minute',now(),'2024-01-19Z',NULL),
      ('${ingestionIds.failedRun}','${ingestionIds.subscription}','failed',1,'2024-01-18Z','2024-01-19Z',
        'observation_time','{"token":"secret"}',
        'failed',false,0,NULL,now(),now(),NULL,'https://private/MAP_KEY/token');
    INSERT INTO firebridge.ingestion_checkpoints
      (subscription_id,stage,cursor_basis,committed_until,last_success_run_id,updated_at)
      VALUES ('${ingestionIds.subscription}','fetch','observation_time','2024-01-18Z','${ingestionIds.emptyRun}',now());
    INSERT INTO firebridge.ingestion_gaps
      (id,subscription_id,gap_start,gap_end_exclusive,kind,status,discovered_at,evidence)
      VALUES ('${ingestionIds.terraGap}','${ingestionIds.subscription}','2024-01-18Z','2024-01-19Z',
        'fetch_failed','open',now(),'{"source_ids":["terra"],"private":"secret"}'),
      ('${ingestionIds.aquaGap}','${ingestionIds.subscription}','2024-01-19Z','2024-01-20Z',
        'provider_outage','retrying',now(),'{"source_ids":["aqua"],"url":"secret"}');
  `);
}
