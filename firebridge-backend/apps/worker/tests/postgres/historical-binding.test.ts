import { randomUUID, createHash } from 'node:crypto';
import { prisma, disconnectDatabase } from '@firebridge/database';
import { afterAll, expect, it } from 'vitest';
import { workerAnalysesRepository, AnalysisLeaseLost, InvalidAnalysisTask } from '../../src/repositories/analyses.repository.js';

async function fixture() {
  const ids = { area: randomUUID(), catalog: randomUUID(), release: randomUUID(), analysis: randomUUID(), job: randomUUID(), run: randomUUID() };
  const hash = createHash('sha256').update(ids.analysis).digest('hex');
  await prisma.$executeRaw`INSERT INTO firebridge.areas(id,name,version,geom,geometry_sha256,display_timezone,provenance)
    VALUES (${ids.area}::uuid,'TEST ONLY history binding',${ids.area},ST_Multi(ST_MakeEnvelope(-6,34,-4,36,4326)),${hash},'UTC','fixture')`;
  await prisma.$executeRaw`INSERT INTO firebridge.metric_definitions
    (id,version,unit,family,description,definition,requires_masks,requires_model)
    VALUES ('native_detections_v1','1','count','native_detections','Native count','{}',false,false) ON CONFLICT DO NOTHING`;
  const result = { engine: 'archive-selection-v1', catalog_id: ids.catalog, area_id: ids.area,
    start: '2020-01-01', end_exclusive: '2021-01-01', source_ids: ['terra'] };
  for (const [id, config] of [[ids.catalog, { engine: 'archive-selection-v1' }], [ids.release, result]] as const) {
    await prisma.$executeRaw`INSERT INTO firebridge.data_releases
      (id,name,status,stream,code_version,config,config_sha256,manifest_uri,dataset_kind,scope_key,observation_cutoff,published_at)
      VALUES (${id}::uuid,${'TEST ONLY historical binding '+id},'published','retrospective','fixture',${JSON.stringify(config)}::jsonb,
        ${hash},'objects/fixture.json','satellite',${ids.area},'2021-01-01',now())`;
  }
  await prisma.$executeRaw`INSERT INTO firebridge.pipeline_runs(id,release_id,stage,idempotency_key,status,code_version,config,input_manifest_uri)
    VALUES (${ids.run}::uuid,${ids.release}::uuid,'archive-selection',${ids.run},'succeeded','fixture','{}','fixture')`;
  await prisma.$executeRaw`INSERT INTO firebridge.analyses
    (id,area_id,release_id,start_date,end_date_exclusive,time_basis,metric_key,selection_policy,weighting_version,
      weather_policy,news_policy,request_spec,cache_key,status)
    VALUES (${ids.analysis}::uuid,${ids.area}::uuid,${ids.catalog}::uuid,'2020-01-01','2021-01-01','utc',
      'native_detections_v1','standard','v1','{}','{}',${JSON.stringify({ history_catalog_id: ids.catalog, data_mode: 'standard_only' })}::jsonb,${hash},'queued')`;
  await prisma.$executeRaw`INSERT INTO firebridge.api_jobs
    (id,kind,analysis_id,request_hash,idempotency_key,request_spec,status,progress)
    VALUES (${ids.job}::uuid,'analysis',${ids.analysis}::uuid,${hash},${ids.job},'{}','queued','{}')`;
  await prisma.$executeRaw`INSERT INTO firebridge.analysis_components(analysis_id,component,release_id,status,reasons)
    VALUES (${ids.analysis}::uuid,'satellite',${ids.catalog}::uuid,'missing','[]')`;
  const payload = { job_id: ids.job, analysis_id: ids.analysis, area_id: ids.area, metric_key: 'native_detections_v1', start_date: '2020-01-01', end_date_exclusive: '2021-01-01' };
  const claimed = await workerAnalysesRepository.claim(payload);
  if (claimed.kind !== 'claimed') throw new Error('Fixture was not claimed');
  return { ids, hash, payload, claim: claimed.claim };
}

it('binds only a successful matching preparation while preserving the original analysis cache identity', async () => {
  const { ids, hash, payload, claim } = await fixture();
  expect(await workerAnalysesRepository.needsHistoricalPreparation(ids.analysis)).toBe(true);
  expect(await workerAnalysesRepository.renew(payload, claim)).toBe(true);
  await expect(workerAnalysesRepository.attachHistoricalResult(payload, claim, ids.run, ids.catalog)).rejects.toBeInstanceOf(InvalidAnalysisTask);
  await workerAnalysesRepository.attachHistoricalResult(payload, claim, ids.run, ids.release);
  expect(await workerAnalysesRepository.complete(payload, claim)).toBe('ready');
  const [row] = await prisma.$queryRaw<{ release_id: string; cache_key: string; status: string }[]>`
    SELECT release_id::text,cache_key,status FROM firebridge.analyses WHERE id=${ids.analysis}::uuid`;
  expect(row).toEqual({ release_id: ids.release, cache_key: hash, status: 'ready' });
  expect(await workerAnalysesRepository.renew(payload, claim)).toBe(false);
});

it('fences a stale worker from binding a historical result', async () => {
  const { ids, payload, claim } = await fixture();
  await prisma.$executeRaw`UPDATE firebridge.api_jobs SET attempt=attempt+1 WHERE id=${ids.job}::uuid`;
  expect(await workerAnalysesRepository.renew(payload, claim)).toBe(false);
  await expect(workerAnalysesRepository.attachHistoricalResult(payload, claim, ids.run, ids.release)).rejects.toBeInstanceOf(AnalysisLeaseLost);
  const [row] = await prisma.$queryRaw<{ release_id: string }[]>`SELECT release_id::text FROM firebridge.analyses WHERE id=${ids.analysis}::uuid`;
  expect(row.release_id).toBe(ids.catalog);
});

afterAll(() => disconnectDatabase());
