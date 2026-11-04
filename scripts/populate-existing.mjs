/** Additive, repeatable SYNTHETIC TEST data in the explicitly existing local database. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';
import { root, run, dockerExecutable } from './audit/process.mjs';
import { decodeMvtPoints } from './phase4/mvt.mjs';

dotenv.config({ path: resolve(root, '.env'), quiet: true });
const fixture = 'synthetic-rif-v1';
const scope = process.env.DEFAULT_SCOPE_KEY || 'morocco';
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/firebridge', 'Only the existing local firebridge database is allowed.');
assert.notEqual(process.env.NODE_ENV, 'production');
assert.equal(scope, 'morocco', 'This fixture is specifically bounded to Morocco.');
const directory = resolve(root, '.data/population', fixture);
await mkdir(directory, { recursive: true });
const docker = dockerExecutable();
const sha = (v) => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)).digest('hex');
function id(name) { const h = sha(fixture + ':' + name); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }
const canonical = (value) => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort().map(([k,v]) => [k, JSON.parse(canonical(v))])) : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : value);
async function immutable(name, text) {
  const path = resolve(directory, name);
  try { await writeFile(path, text, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await readFile(path, 'utf8'), text, 'Existing fixture artifact differs: ' + name); }
}
let generatedAt;
try { generatedAt = JSON.parse(await readFile(resolve(directory, 'identity.json'), 'utf8')).generated_at; }
catch (error) { if (error.code !== 'ENOENT') throw error; generatedAt = new Date().toISOString(); await immutable('identity.json', JSON.stringify({ fixture, generated_at: generatedAt, synthetic: true })); }
const provenance = { synthetic: true, test_only: true, fixture, not_for_scientific_use: true, real_observation_coverage: false, origin: 'FIREBRIDGE deterministic synthetic generator; NOT NASA observations', license: 'CC0-1.0 for generated fixture records only' };
const sources = [
  { key: 'terra', platform: 'Terra', instrument: 'MODIS', product: 'MOD14', collection: '6.1', resolution: 1000, hour: 10 },
  { key: 'aqua', platform: 'Aqua', instrument: 'MODIS', product: 'MYD14', collection: '6.1', resolution: 1000, hour: 13 },
  { key: 'snpp', platform: 'Suomi-NPP', instrument: 'VIIRS', product: 'VNP14IMG', collection: '2', resolution: 375, hour: 13 },
].map(s => ({ ...s, id: `SYNTHETIC_TEST_${s.key}_${s.product}_${fixture}`, documentation: `https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/${s.product}/` }));
const days = ['2024-07-15', '2024-07-16', '2024-07-17'];
const start = days[0] + 'T00:00:00Z', end = '2024-07-18T00:00:00Z';
const geometry = { type: 'Polygon', coordinates: [[[-6,34.7],[-4.5,34.7],[-4.5,35.6],[-6,35.6],[-6,34.7]]] };
const subsetGeometry = { type: 'Polygon', coordinates: [[[-5.65,35.05],[-5.15,35.05],[-5.15,35.35],[-5.65,35.35],[-5.65,35.05]]] };
const centres = [[-5.75,35.42],[-5.5,35.18],[-5.25,35.28],[-4.85,35.05]];
const rows = sources.flatMap((s, si) => days.flatMap((day, di) => centres.map(([lon,lat], n) => ({
  source_id: s.id, native_record_key: `SYNTHETIC_TEST/${fixture}/${s.key}/${day}/${n+1}`,
  acquired_at: `${day}T${String((s.hour + (n >= 2 ? 12 : 0)) % 24).padStart(2,'0')}:${String(30 + n*3 + si).padStart(2,'0')}:00Z`,
  longitude: Number((lon + si*0.008 + di*0.004).toFixed(6)), latitude: Number((lat + si*0.006 + di*0.003).toFixed(6)),
  processing_level: 'standard', confidence_raw: null, frp_mw: null, brightness_bands: {}, day_night: 'unknown', ...provenance,
}))));
const containerDirectory = '/app/.data/exports/seed/' + fixture;
const uri = (name) => 'file://' + containerDirectory + '/' + name;
const artifacts = {};
for (const s of sources) artifacts[`asset-${s.key}.json`] = JSON.stringify(rows.filter(r => r.source_id === s.id));
for (const s of sources) for (const day of days) artifacts[`partition-${s.key}-${day}.json`] = JSON.stringify(rows.filter(r => r.source_id === s.id && r.acquired_at.startsWith(day)));
artifacts['manifest.json'] = JSON.stringify({ ...provenance, generated_at: generatedAt, scope, start, end_exclusive: end, sources, records: rows.length, scientific_measurements: 'FRP, confidence and brightness intentionally absent', coverage: 'Only the generated fixture inventory is complete; no satellite observation coverage is asserted.' }, null, 2);
for (const [name,text] of Object.entries(artifacts)) await immutable(name, text);

const pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
const base = 'http://127.0.0.1:3000/api/v1';
async function api(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}: ${JSON.stringify(body)}`);
  return { status: response.status, data: body.data };
}
async function waitJob(jobId) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const job = (await api('/jobs/' + jobId)).data;
    if (!['queued','running'].includes(job.status)) { assert.ok(['partial','succeeded'].includes(job.status), JSON.stringify(job)); return job; }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Worker did not finish job ' + jobId);
}
async function snapshot() {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='firebridge' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    result[tablename] = (await pool.query(`SELECT to_jsonb(t)::text AS row FROM firebridge.${tablename} t`)).rows.map(r => sha(r.row)).sort();
  }
  return result;
}
try {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'firebridge');
  const actualScope = (await run(docker, ['exec','firebridge-api','node','-p',"process.env.DEFAULT_SCOPE_KEY || 'morocco'"])).stdout.trim();
  assert.equal(actualScope, scope, 'Host and Docker API scopes must agree.');
  const historyBefore = (await pool.query('SELECT to_jsonb(m)::text AS row FROM firebridge._prisma_migrations m ORDER BY id')).rows;
  const before = await snapshot();
  const stamp = Date.now(); const remoteBackup = `/tmp/firebridge-before-population-${stamp}.dump`;
  await run(docker, ['exec','firebridge-postgres','pg_dump','-U','firebridge','-d','firebridge','-Fc','-f',remoteBackup]);
  const backup = resolve(directory, `before-${stamp}.dump`);
  await run(docker, ['cp',`firebridge-postgres:${remoteBackup}`,backup]);
  const backupHash = sha(await readFile(backup));
  assert.equal((await run(docker,['exec','firebridge-postgres','sha256sum',remoteBackup])).stdout.split(/\s/)[0], backupHash);
  await run(docker,['exec','firebridge-postgres','pg_restore','--list',remoteBackup]);
  console.info('Existing database inspected and backed up; no database or environment created.');
  const copyCode = "const fs=require('node:fs');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const a=JSON.parse(s);const d='/app/.data/exports/seed/synthetic-rif-v1';fs.mkdirSync(d,{recursive:true});for(const [n,t]of Object.entries(a)){if(!/^[a-z0-9_.-]+$/.test(n))throw Error('Invalid artifact name');const p=d+'/'+n;try{fs.writeFileSync(p,t,{flag:'wx',mode:0o644})}catch(e){if(e.code!=='EEXIST'||fs.readFileSync(p,'utf8')!==t)throw e}}});";
  await run(docker,['exec','-i','-u','node','firebridge-api','node','-e',copyCode],{ input: JSON.stringify(artifacts) });
  const { computeGeometrySha256 } = await import('../apps/api/dist/services/areas.service.js');
  const client = await pool.connect(); const inserted = {}; const reused = {};
  async function insert(table, record, keys = ['id']) {
    assert.match(table,/^[a-z_][a-z0-9_]*$/); for (const key of Object.keys(record)) assert.match(key,/^[a-z_][a-z0-9_]*$/);
    const columns = Object.keys(record); const values = Object.values(record);
    const placeholders = columns.map((key,i) => ['geom','footprint'].includes(key) ? (record[key].type === 'Point' ? `ST_SetSRID(ST_GeomFromGeoJSON($${i+1}),4326)` : `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${i+1}),4326))`) : `$${i+1}`);
    const params = values.map(v => v && typeof v === 'object' ? JSON.stringify(v) : v);
    const written = await client.query(`INSERT INTO firebridge.${table}(${columns.join(',')}) VALUES(${placeholders.join(',')}) ON CONFLICT DO NOTHING RETURNING 1`,params);
    const where = keys.map((k,i)=>`${k}=$${i+1}`).join(' AND ');
    const found = (await client.query(`SELECT ${table === 'partition_detections' ? `to_jsonb(t)||jsonb_build_object('detection_id',t.detection_id::text)` : 'to_jsonb(t)'} AS row FROM firebridge.${table} t WHERE ${where}`,keys.map(k=>record[k]))).rows[0]?.row;
    assert.ok(found, 'Conflicting existing key in ' + table);
    for (const key of columns) {
      if (['geom','footprint'].includes(key)) {
        const equal = await client.query(`SELECT ST_Equals(${key},ST_SetSRID(ST_GeomFromGeoJSON($${keys.length+1}),4326)) AS ok FROM firebridge.${table} WHERE ${where}`,[...keys.map(k=>record[k]),JSON.stringify(record[key])]);
        assert.equal(equal.rows[0].ok,true);
      } else if (/_at$|^time_start$|^time_end$|^observation_cutoff$/.test(key)) assert.equal(Date.parse(found[key]),Date.parse(record[key]));
      else assert.equal(canonical(found[key]),canonical(record[key]),'Existing record differs: '+table+'.'+key);
    }
    const counts = written.rowCount ? inserted : reused; counts[table]=(counts[table]||0)+1;
  }
  try {
    await client.query('BEGIN'); await client.query("SET LOCAL search_path=firebridge,public");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[fixture]);
    for (const s of sources) await insert('sources',{ id:s.id, name:`SYNTHETIC TEST — ${s.platform} ${s.product}`, provider:'FIREBRIDGE synthetic fixture generator',kind:'hotspots',platform:s.platform,instrument:s.instrument,product:s.product,collection:s.collection,processing_stream:'standard',documentation_url:s.documentation,citation:`SYNTHETIC TEST only; ${s.documentation} documents the real product, not these records`,license_info:provenance.license,native_resolution_m:s.resolution,schema_version:'1',metadata:{...provenance,metadata_reference:s.documentation,simulation_of_processing_mode:'standard_only'} });
    for (const [key,geom] of [['area',geometry],['subset-area',subsetGeometry]]) {
      const checks=(await client.query('SELECT ST_IsValid(ST_GeomFromGeoJSON($1)) AS valid,ST_Area(ST_GeomFromGeoJSON($1)::geography)/1e6 AS km2',[JSON.stringify(geom)])).rows[0];
      assert.ok(checks.valid && checks.km2>0 && checks.km2<=250000);
      await insert('areas',{id:id(key),name:`SYNTHETIC TEST — Rif ${key}`,version:fixture,geom,geometry_sha256:computeGeometrySha256(geom),display_timezone:'Africa/Casablanca',provenance:`SYNTHETIC TEST geometry, ${fixture}; not an observed fire boundary`});
    }
    const metric=(await client.query("SELECT * FROM firebridge.metric_definitions WHERE id='native_detections_v1'")).rows[0];
    assert.ok(metric && metric.family==='native_detections' && !metric.requires_masks && !metric.requires_model,'Existing native metric required; no metric is overwritten.');
    const config={...provenance,metric_ids:['native_detections_v1'],source_ids:sources.map(s=>s.id),manifest_sha256:sha(artifacts['manifest.json'])};
    await insert('data_releases',{id:id('release'),name:`SYNTHETIC TEST — ${fixture} — NOT NASA observations`,status:'published',stream:'retrospective',code_version:fixture,config,config_sha256:sha(config),manifest_uri:uri('manifest.json'),dataset_kind:'satellite',scope_key:scope,observation_cutoff:end,published_at:generatedAt});
    await insert('pipeline_runs',{id:id('run'),release_id:id('release'),stage:'synthetic_fixture_validation',idempotency_key:`${fixture}:pipeline`,status:'succeeded',code_version:fixture,config:provenance,input_manifest_uri:uri('manifest.json'),output_manifest_uri:uri('manifest.json'),started_at:generatedAt,finished_at:generatedAt});
    for(const s of sources){const name=`asset-${s.key}.json`;await insert('assets',{id:id('asset-'+s.key),source_id:s.id,native_key:`SYNTHETIC_TEST/${fixture}/${s.product}`,revision:'1',source_url:uri(name),storage_uri:uri(name),sha256:sha(artifacts[name]),byte_size:Buffer.byteLength(artifacts[name]),time_start:start,time_end:end,footprint:geometry,retrieved_at:generatedAt,validation_status:'accepted',metadata:provenance});await insert('release_assets',{release_id:id('release'),asset_id:id('asset-'+s.key),role:'synthetic_test_input'},['release_id','asset_id','role']);}
    const detectionIds={};
    for(const row of rows){const s=sources.find(s=>s.id===row.source_id);await insert('detections',{asset_id:id('asset-'+s.key),source_id:s.id,native_record_key:row.native_record_key,record_sha256:sha(row),identity_method:'synthetic_fixture_not_observed',processing_level:'standard',acquired_at:row.acquired_at,geom:{type:'Point',coordinates:[row.longitude,row.latitude]},confidence_raw:null,confidence_scheme:'synthetic_not_measured',day_night:'unknown',frp_mw:null,brightness_bands:{},native_fields:{...row,...provenance}},['asset_id','native_record_key']);detectionIds[row.native_record_key]=(await client.query('SELECT id::text FROM firebridge.detections WHERE asset_id=$1 AND native_record_key=$2',[id('asset-'+s.key),row.native_record_key])).rows[0].id;}
    for(const s of sources)for(const day of days){const members=rows.filter(r=>r.source_id===s.id&&r.acquired_at.startsWith(day));const next=new Date(Date.parse(day)+86400000).toISOString();const name=`partition-${s.key}-${day}.json`;const partitionId=id('partition-'+s.key+'-'+day);await insert('data_partitions',{id:partitionId,pipeline_run_id:id('run'),kind:'detections',series_key:s.id,partition_key:day,support_spec:{...provenance,source_ids:[s.id],start:day+'T00:00:00Z',end_exclusive:next,inventory_complete:true,completeness_scope:'generated_fixture_inventory_only'},storage_uri:uri(name),sha256:sha(artifacts[name]),input_manifest_uri:uri('manifest.json'),schema_version:'1',row_count:members.length,serving_complete:true,validation_status:'validated'});for(const row of members)await insert('partition_detections',{partition_id:partitionId,detection_id:detectionIds[row.native_record_key]},['partition_id','detection_id']);await insert('release_partitions',{release_id:id('release'),series_key:s.id,partition_key:day,partition_id:partitionId},['release_id','series_key','partition_key']);}
    const bad=(await client.query('SELECT count(*) FROM firebridge.data_partitions p WHERE pipeline_run_id=$1 AND row_count<>(SELECT count(*) FROM firebridge.partition_detections pd WHERE pd.partition_id=p.id)',[id('run')])).rows[0].count;assert.equal(Number(bad),0);
    await insert('release_aliases',{alias:'synthetic_test_native_v1',scope_key:scope,release_id:id('release'),generation:1,updated_at:generatedAt},['alias','scope_key']);
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  console.info(JSON.stringify({fixture,inserted,reused,synthetic_detections:rows.length}));
  const ready=await api('/health/ready'); assert.equal(ready.status,200); assert.equal(ready.data.checks.catalogue,'ready');
  const analyses={};
  for(const key of ['area','subset-area']){
    const accepted=(await api('/analyses',{method:'POST',headers:{'Idempotency-Key':`${fixture}:analysis:${key}`},body:JSON.stringify({area_id:id(key),start_date:days[0],end_date_exclusive:end.slice(0,10)})})).data;
    await waitJob(accepted.job_id); const analysis=(await api('/analyses/'+accepted.id)).data;assert.equal(analysis.release_id,id('release'));assert.equal(analysis.status,'partial');analyses[key]=analysis;
  }
  const analysisId=analyses.area.id;
  const tileResponse=await fetch(`${base}/analyses/${analysisId}/tiles/detections/0/0/0.mvt`);assert.equal(tileResponse.status,200);
  const tile=Buffer.from(await tileResponse.arrayBuffer());const tileCount=decodeMvtPoints(tile).flatMap(l=>l.features).reduce((n,f)=>n+Number(f.properties.count),0);assert.equal(tileCount,rows.length);
  await writeFile(resolve(directory,'detections-z0.mvt'),tile);
  const exports={};const exportDay=new Date().toISOString().slice(0,10);
  for(const format of ['csv','geojson','parquet']){
    const key=`${fixture}:export:${exportDay}:${format}`;
    const durable='export:'+sha(JSON.stringify([analysisId,key]));
    const existing=(await pool.query('SELECT id::text FROM firebridge.api_jobs WHERE idempotency_key=$1',[durable])).rows[0];
    const jobId=existing?.id||(await api(`/analyses/${analysisId}/exports`,{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify({format})})).data.job_id;
    const job=await waitJob(jobId);assert.equal(job.status,'succeeded');assert.ok(job.download_url,'Existing file expired: use a new daily export key.');
    const download=await fetch('http://127.0.0.1:3000'+job.download_url);assert.equal(download.status,200);const bytes=Buffer.from(await download.arrayBuffer());
    if(format==='csv'){assert.equal(bytes.toString().trim().split('\n').length,rows.length+1);assert.ok(bytes.toString().includes('SYNTHETIC_TEST_'));}
    if(format==='geojson'){const json=JSON.parse(bytes);assert.equal(json.features.length,rows.length);assert.ok(json.features.every(f=>f.properties.source_id.startsWith('SYNTHETIC_TEST_')&&f.properties.frp_mw===null));}
    if(format==='parquet'){assert.equal(bytes.subarray(0,4).toString(),'PAR1');assert.equal(bytes.subarray(-4).toString(),'PAR1');}
    const stored=(await pool.query('SELECT result_sha256,result_byte_size FROM firebridge.api_jobs WHERE id=$1',[jobId])).rows[0];assert.equal(stored.result_sha256,sha(bytes));assert.equal(Number(stored.result_byte_size),bytes.length);
    await writeFile(resolve(directory,`SYNTHETIC_TEST_export.${format}`),bytes);
    exports[format]={job_id:jobId,bytes:bytes.length,sha256:sha(bytes),expires_at:job.expires_at,status_url:`/api/v1/jobs/${jobId}`,download_instructions:'GET status_url for a fresh 5-minute signed download_url'};
    console.info(`${format}: completed by existing Docker worker; ${bytes.length} bytes verified.`);
  }
  const after=await snapshot();for(const [table,hashes]of Object.entries(before)){const current=new Set(after[table]);assert.ok(hashes.every(h=>current.has(h)),'A preexisting row changed in '+table);}
  assert.deepEqual((await pool.query('SELECT to_jsonb(m)::text AS row FROM firebridge._prisma_migrations m ORDER BY id')).rows,historyBefore);
  const results={fixture,...provenance,completed_at:new Date().toISOString(),database:'firebridge',scope,interval:{start,end_exclusive:end},sources:sources.map(s=>s.id),release_id:id('release'),alias:'synthetic_test_native_v1',area_id:id('area'),'subset_area_id':id('subset-area'),analyses:Object.fromEntries(Object.entries(analyses).map(([k,v])=>[k,{id:v.id,status:v.status,job_id:v.job.id}])),detection_count:rows.length,partition_count:9,tile_detection_count:tileCount,exports,inserted,reused,readiness:200,preexisting_rows_preserved:true,migration_history_unchanged:true,backup,backup_sha256:backupHash};
  await writeFile(resolve(directory,'results.json'),JSON.stringify(results,null,2));console.info(JSON.stringify(results,null,2));
} finally { await pool.end(); }
