import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
const url = new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test' || !/^\/firebridge_http_\d+_test$/.test(url.pathname)) throw new Error('Isolated HTTP test database required.');
const pool = new pg.Pool({ connectionString: url.href });
const base = 'http://127.0.0.1:3301/api/v1';
const get = (path) => fetch(base + path, { signal: AbortSignal.timeout(10000) });
async function createArea(geometry, version = randomUUID()) {
  const response = await fetch(base + '/areas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'TEST ONLY geometry', version, display_timezone: 'UTC', provenance: 'isolated-http-test', geometry }) });
  return { status: response.status, body: await response.json() };
}
try {
  const geometry = { type: 'Polygon', coordinates: [
    [[179, -1], [-179, -1], [-179, 1], [179, 1], [179, -1]],
    [[179.3, -0.5], [-179.3, -0.5], [-179.3, 0.5], [179.3, 0.5], [179.3, -0.5]],
  ] };
  const version = randomUUID();
  const created = await createArea(geometry, version);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const reused = await createArea({ ...geometry, coordinates: geometry.coordinates.map((ring) => [...ring].reverse()) }, version);
  assert.equal(reused.status, 200); assert.equal(reused.body.data.id, created.body.data.id);
  const { rows: [spatial] } = await pool.query(`SELECT ST_IsValid(geom) AS valid,
    ST_Covers(geom,ST_SetSRID(ST_Point(179.1,0),4326)) AS east,
    ST_Covers(geom,ST_SetSRID(ST_Point(-179.1,0),4326)) AS west,
    ST_Covers(geom,ST_SetSRID(ST_Point(0,0),4326)) AS greenwich,
    ST_Covers(geom,ST_SetSRID(ST_Point(179.5,0),4326)) AS hole
    FROM firebridge.areas WHERE id=$1::uuid`, [created.body.data.id]);
  assert.deepEqual(spatial, { valid: true, east: true, west: true, greenwich: false, hole: false });
  assert.equal((await createArea({ type: 'Polygon', coordinates: [[[0,0],[1,1],[1,0],[0,1],[0,0]]] })).status, 400);
  const { rows: [job] } = await pool.query("SELECT id::text,analysis_id::text FROM firebridge.api_jobs WHERE kind='export' AND status='succeeded' ORDER BY created_at LIMIT 1");
  assert.ok(job);
  const detail = await (await get('/jobs/' + job.id)).json();
  const signedPath = detail.data.download_url.replace('/api/v1', '');
  assert.equal((await get('/jobs/' + job.id + '/download')).status, 400);
  const tampered = new URL(base + signedPath); tampered.searchParams.set('signature', '0'.repeat(64));
  assert.equal((await fetch(tampered)).status, 400);
  const pending = randomUUID();
  await pool.query("INSERT INTO firebridge.api_jobs(id,kind,analysis_id,request_hash,idempotency_key,request_spec,status) VALUES($1,'export',$2,'test',$3,'{\"format\":\"csv\",\"filters\":{},\"options\":{}}','queued')", [pending, job.analysis_id, 'test-pending-' + pending]);
  assert.equal((await get('/jobs/' + pending + '/download')).status, 409);
  await pool.query("UPDATE firebridge.api_jobs SET expires_at=now()-interval '1 second' WHERE id=$1::uuid", [job.id]);
  assert.equal((await get(signedPath)).status, 410);
  assert.equal((await get('/jobs/' + randomUUID() + '/download')).status, 404);
  assert.equal(Number((await pool.query('SELECT count(*) FROM firebridge.api_jobs WHERE requested_by IS NOT NULL')).rows[0].count), 0);
  assert.equal(Number((await pool.query('SELECT count(*) FROM firebridge.analysis_request_keys WHERE requested_by IS NOT NULL')).rows[0].count), 0);
  assert.equal(Number((await pool.query("SELECT count(*) FROM information_schema.columns WHERE table_schema='firebridge' AND column_name='owner_subject'")).rows[0].count), 0);
  const badOrigin = await fetch(base + '/health/live', { headers: { Origin: 'https://unconfigured.invalid' } });
  assert.equal(badOrigin.headers.get('access-control-allow-origin'), null);
  assert.equal(badOrigin.headers.get('access-control-allow-credentials'), null);
  await pool.query("UPDATE firebridge.release_aliases SET scope_key='temporarily_unservable' WHERE scope_key='phase1_test'");
  try { const response = await get('/health/ready'); assert.equal(response.status, 503); assert.equal((await response.json()).data.checks.catalogue, 'unavailable'); }
  finally { await pool.query("UPDATE firebridge.release_aliases SET scope_key='phase1_test' WHERE scope_key='temporarily_unservable'"); }
  console.info(JSON.stringify({ antimeridian_with_hole_and_reuse: true, invalid_geometry_rejected: true, pending_409: true, expired_410: true, signed_link_tampering_rejected: true, identity_fields_unused: true, cors_restricted: true, catalogue_readiness_503_without_alias: true }));
} finally { await pool.end(); }
