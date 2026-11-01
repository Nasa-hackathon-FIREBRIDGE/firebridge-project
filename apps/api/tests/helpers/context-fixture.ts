import type pg from 'pg';
import { evidenceHash } from '@firebridge/contracts';
import { nativeIds, seedNativeResults } from './native-fixture.js';
import { ids } from './database.js';

export const contextId = (n: number) => '60000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const contextIds = {
  historical: contextId(1),
  recent: contextId(2),
  reports: contextId(3),
  science: contextId(100)
};

/** Synthetic records only. The actual database is checked before the first write. */
export async function seedContext(pool: pg.Pool) {
  await seedNativeResults(pool);
  await pool.query('TRUNCATE firebridge.outbox_events');
  const hash = 'a'.repeat(64);
  for (const [index, source, kind] of [
    [1, 'wx_history', 'weather'],
    [2, 'wx_recent', 'weather'],
    [3, 'fixture_reports', 'news']
  ] as const) {
    await pool.query(
      `INSERT INTO firebridge.sources
      (id,name,provider,kind,product,collection,processing_stream,documentation_url,citation,license_info,schema_version)
      VALUES($1,$1,'TEST ONLY',$2,'synthetic','1','fixture','https://example.org','Synthetic fixture','fixture','1')`,
      [source, kind]
    );
    await pool.query(
      `INSERT INTO firebridge.assets
      (id,source_id,native_key,revision,source_url,storage_uri,sha256,byte_size,retrieved_at,validation_status)
      VALUES($1,$2,'fixture','1','https://private.example/MAP_KEY/secret','s3://private/input',$3,1,now(),'accepted')`,
      [contextId(index + 10), source, hash]
    );
    await pool.query(
      `INSERT INTO firebridge.data_releases
      (id,name,status,stream,code_version,config,config_sha256,manifest_uri,dataset_kind,scope_key,observation_cutoff,published_at)
      VALUES($1::uuid,'TEST ONLY context '||$1::text,'published','retrospective','fixture','{}',$2,'s3://private/manifest',$3,'phase1_test','2024-01-20Z',now())`,
      [contextId(index), hash, index === 3 ? 'reports' : 'weather']
    );
    await pool.query("INSERT INTO firebridge.release_assets VALUES($1,$2,'raw')", [
      contextId(index),
      contextId(index + 10)
    ]);
    const members =
      index === 1
        ? { weather_value_ids: ['1001', '1003'] }
        : index === 2
          ? { weather_value_ids: ['1002'] }
          : { reported_event_ids: [contextId(41), contextId(42)] };
    await pool.query(
      `INSERT INTO firebridge.data_partitions
      (id,pipeline_run_id,kind,series_key,partition_key,support_spec,storage_uri,sha256,input_manifest_uri,schema_version,row_count,serving_complete,validation_status)
      VALUES($1,'dddddddd-dddd-4ddd-8ddd-dddddddddddd',$2,$3,'fixture',$4,'s3://private/partition',$5,'private','1',$6,true,'validated')`,
      [
        contextId(index + 20),
        index === 3 ? 'reports' : 'weather',
        source,
        JSON.stringify(members),
        hash,
        index === 2 ? 1 : 2
      ]
    );
    await pool.query("INSERT INTO firebridge.release_partitions VALUES($1,$2,'fixture',$3)", [
      contextId(index),
      source,
      contextId(index + 20)
    ]);
    await pool.query(
      `INSERT INTO firebridge.analysis_components VALUES($1,$2,$3,'ready','[]')
      ON CONFLICT(analysis_id,component) DO UPDATE SET release_id=EXCLUDED.release_id,status='ready'`,
      [
        nativeIds.analysis,
        index === 1 ? 'weather_historical' : index === 2 ? 'weather_recent' : 'reports',
        contextId(index)
      ]
    );
  }
  for (const [n, source, x, y] of [
    [31, 'wx_history', -7.5, 30.5],
    [32, 'wx_recent', -7.5, 30.5],
    [33, 'wx_history', -6, 32]
  ] as const) {
    await pool.query(
      `INSERT INTO firebridge.weather_locations(id,source_id,native_location_key,support_kind,geom,metadata)
      VALUES($1::uuid,$2,$1::text,'sample_point',ST_SetSRID(ST_MakePoint($3,$4),4326),'{"private":"secret"}')`,
      [contextId(n), source, x, y]
    );
  }
  for (const [id, loc, source, asset, date, kind, value] of [
    [1001, 31, 'wx_history', 11, '2024-01-17T00:00:00Z', 'reanalysis', 20],
    [1002, 32, 'wx_recent', 12, '2024-01-18T12:00:00Z', 'forecast', 25],
    [1003, 33, 'wx_history', 11, '2024-01-18T00:00:00Z', 'reanalysis', 90],
    [1004, 31, 'wx_history', 11, '2024-01-19T00:00:00Z', 'reanalysis', 99]
  ] as const) {
    await pool.query(
      `INSERT INTO firebridge.weather_values
      (id,location_id,source_id,asset_id,variable,unit,valid_start,valid_end,issued_at,data_kind,statistic,value,quality_status)
      OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,'temperature','C',$5::timestamptz,$5::timestamptz+interval '1 hour',
        CASE WHEN $6='forecast' THEN $5::timestamptz ELSE NULL END,$6,'mean',$7,'valid')`,
      [id, contextId(loc), source, contextId(asset), date, kind, value]
    );
  }
  const manifest =
    'urn:firebridge:weather-inputs-v1:' +
    evidenceHash({
      analysis_id: nativeIds.analysis,
      component: 'weather_historical',
      release_id: contextIds.historical,
      weather_value_ids: ['1001', '1003'],
      area_id: nativeIds.area,
      weighting_version: 'v1',
      start_date: '2024-01-17',
      end_date_exclusive: '2024-01-20'
    });
  await pool.query(
    `INSERT INTO firebridge.weather_summaries
    (id,analysis_id,source_id,variable,unit,period_start,period_end,statistic,value,spatial_method,spatial_weights_uri,
     input_manifest_uri,temporal_coverage_fraction,spatial_coverage_fraction,status)
    VALUES($1,$2,'wx_history','temperature','C','2024-01-17Z','2024-01-18Z','mean',20,'area_weighted','s3://private/weights',$3,1,1,'supported')`,
    [contextId(50), nativeIds.analysis, manifest]
  );
  for (let n = 1; n <= 3; n++) {
    await pool.query(
      `INSERT INTO firebridge.news_reports
      (id,asset_id,canonical_url,title,publisher,language,published_at,publication_precision,retrieved_at,content_sha256,source_lineage,extraction_version,review_status)
      VALUES($1,$2,$3,'TEST ONLY report','Fixture','fr','2024-01-18Z','day',now(),$4,'field_report','fixture',$5)`,
      [
        contextId(60 + n),
        contextId(13),
        `https://reports.example.org/article/${n}?token=private`,
        hash,
        n === 2 ? 'reviewed' : 'unreviewed'
      ]
    );
    await pool.query(
      `INSERT INTO firebridge.reported_events
      (id,report_id,claim_index,event_start,event_end_exclusive,date_precision,place_text,location_precision,claim_summary,review_status)
      VALUES($1,$2,1,'2024-01-17','2024-01-19','day','TEST ONLY province','province','Unverified synthetic claim',$3)`,
      [contextId(40 + n), contextId(60 + n), n === 2 ? 'reviewed' : 'unreviewed']
    );
    await pool.query(
      `INSERT INTO firebridge.analysis_event_links
      (analysis_id,event_id,relation,match_method_version,temporal_match,spatial_match,independence,evidence_note)
      VALUES($1,$2,$3,'fixture','{}','{}','unknown','TEST ONLY')`,
      [nativeIds.analysis, contextId(40 + n), n === 2 ? 'consistent' : 'candidate']
    );
  }
}

/** Prepared scientific records exercise serving gates; no real mask decoding/model training occurs. */
export async function seedScientificContext(pool: pg.Pool) {
  if (
    (await pool.query('SELECT current_database() AS name')).rows[0].name !==
    'firebridge_phase1_test'
  )
    throw new Error('Test database required.');
  const receipt = {
    publication_gates_passed: true,
    mask_inventory_verified: true,
    metric_key: 'source_response_fixture',
    grid_id: 'phase6_fixture',
    time_basis: 'utc',
    selection_policy: 'standard',
    weighting_version: 'v1',
    support_definition_sha256: 'a'.repeat(64),
    qa_policy_version: 'fixture-qa-v1',
    source_ids: ['terra'],
    model_ids: []
  };
  await pool.query(`INSERT INTO firebridge.metric_definitions VALUES
    ('source_response_fixture','1','dimensionless_reference_response','source_response','TEST ONLY','{}',true,false)`);
  await pool.query(
    `INSERT INTO firebridge.grids VALUES('phase6_fixture','1',4326,1000,0,0,
    ST_Multi(ST_GeomFromText('POLYGON((-8 30,-7 30,-7 31,-8 31,-8 30))',4326)),$1,'{}')`,
    [nativeIds.asset]
  );
  await pool.query(`INSERT INTO firebridge.grid_cells(id,grid_id,grid_x,grid_y,geom,area_m2,land_area_m2)
    OVERRIDING SYSTEM VALUE VALUES(6001,'phase6_fixture',0,0,
    ST_Multi(ST_GeomFromText('POLYGON((-8 30,-7 30,-7 31,-8 31,-8 30))',4326)),1000,1000)`);
  await pool.query("INSERT INTO firebridge.area_cells VALUES($1,6001,1000,'v1')", [nativeIds.area]);
  await pool.query(
    `UPDATE firebridge.data_releases SET config=config||jsonb_build_object('scientific_serving_v1',$2::jsonb) WHERE id=$1`,
    [ids.current, JSON.stringify(receipt)]
  );
  await pool.query(
    `INSERT INTO firebridge.analyses
    (id,area_id,release_id,start_date,end_date_exclusive,time_basis,metric_key,grid_id,selection_policy,weighting_version,weather_policy,news_policy,request_spec,cache_key,status)
    VALUES($1,$2,$3,'2024-01-17','2024-01-20','utc','source_response_fixture','phase6_fixture','standard','v1','{}','{}',
      '{"source_ids":["terra"],"data_mode":"standard_only"}','phase6-science-fixture','ready')`,
    [contextIds.science, nativeIds.area, ids.current]
  );
  await pool.query(
    `INSERT INTO firebridge.analysis_components VALUES($1,'satellite',$2,'ready','[]')`,
    [contextIds.science, ids.current]
  );
  for (let n = 0; n < 3; n++) {
    const date = `2024-01-${17 + n}`;
    await pool.query(
      `INSERT INTO firebridge.observations
      (id,release_id,cell_id,source_id,pass_key,time_start,time_end,representative_time,local_solar_date,regime,
       land_area_m2,usable_land_m2,cloud_land_m2,invalid_land_m2,unobserved_land_m2,coverage_status,
       retained_detection_count,retained_any,eligible,qa_policy_version,usable_support_uri)
      VALUES($1,$2,6001,'terra',$3::text,$3::timestamptz,$3::timestamptz+interval '1 hour',$3::timestamptz,$3::date,'day',
       1000,1000,0,0,0,'usable',$4,$5,true,'fixture-qa-v1','s3://private/usable')`,
      [contextId(110 + n), ids.current, date, n === 1 ? 1 : 0, n === 1]
    );
    await pool.query(
      `INSERT INTO firebridge.observation_assets VALUES($1,$2,'fire_mask'),($1,$2,'geolocation')`,
      [contextId(110 + n), nativeIds.asset]
    );
    await pool.query(
      `INSERT INTO firebridge.daily_activity
      (release_id,cell_id,reporting_date,time_basis,metric_key,selection_policy,observation_id,response_value,status,candidate_count)
      VALUES($1,6001,$2,'utc','source_response_fixture','standard',$3,$4,'reference_observed',1)`,
      [ids.current, date, contextId(110 + n), n === 1 ? 1 : 0]
    );
  }
  await pool.query(
    `INSERT INTO firebridge.calendar_periods
    (analysis_id,period_start,period_end_exclusive,resolution,response_numerator_m2_days,eligible_land_m2_days,
     possible_land_m2_days,valid_cell_days,status)
    VALUES($1,'2024-01-17','2024-01-20','selection',1000,3000,3000,3,'supported')`,
    [contextIds.science]
  );
}

export async function seedComparison(pool: pg.Pool) {
  if (
    (await pool.query('SELECT current_database() AS name')).rows[0].name !==
    'firebridge_phase1_test'
  )
    throw new Error('Test database required.');
  const hash = 'a'.repeat(64);
  await pool.query(
    `INSERT INTO firebridge.feature_sets(id,release_id,version,artifact_uri,sha256,feature_contract,split_manifest_uri,split_sha256,row_count)
    VALUES($1,$2,'fixture','s3://private/features',$3,'{}','s3://private/split',$3,3)`,
    [contextId(150), ids.current, hash]
  );
  await pool.query(
    `INSERT INTO firebridge.model_versions
    (id,name,version,feature_set_id,source_id,reference_source_id,algorithm,artifact_uri,sha256,target_definition,support_domain,calibration_manifest_uri,status)
    VALUES($1,'TEST ONLY model','1',$2,'terra','aqua','fixture','s3://private/model',$3,'{}','{}','s3://private/calibration','validated')`,
    [contextId(151), contextId(150), hash]
  );
  const artifact = {
    area_id: nativeIds.area,
    start_date: '2024-01-17',
    end_date_exclusive: '2024-01-20',
    resolution: 'month',
    view: 'common_response',
    publication_gates_passed: true,
    support_definition_sha256: hash,
    unit: 'dimensionless_reference_response',
    series: [
      {
        source_id: 'terra',
        values: [{ start: '2024-01-17', end_exclusive: '2024-01-20', value: 0.5 }]
      }
    ]
  };
  await pool.query(
    `INSERT INTO firebridge.evaluations
    (id,model_id,release_id,experiment,slice_key,split_manifest_uri,sample_count,positive_count,independent_block_count,metrics,baseline_metrics,report_uri)
    VALUES($1,$2,$3,'fixture','fixture','s3://private/split',3,1,2,$4,'{}','s3://private/report')`,
    [
      contextId(152),
      contextId(151),
      ids.current,
      JSON.stringify({ public_comparison_v1: artifact })
    ]
  );
  await pool.query(
    `UPDATE firebridge.analyses SET request_spec=request_spec||jsonb_build_object('comparison_experiment_id',$2::text) WHERE id=$1`,
    [contextIds.science, contextId(152)]
  );
  await pool.query(
    `UPDATE firebridge.data_releases SET config=jsonb_set(config,'{scientific_serving_v1,model_ids}',$2::jsonb) WHERE id=$1`,
    [ids.current, JSON.stringify([contextId(151)])]
  );
}
