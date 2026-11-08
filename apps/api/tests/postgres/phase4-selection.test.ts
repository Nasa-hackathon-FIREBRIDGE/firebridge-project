import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectDatabase } from '@firebridge/database';
import { findResultContext, readDetectionBatch } from '@firebridge/results';
import { localExportStorage } from '@firebridge/results/storage';
import type { Job } from 'bullmq';
import { createApp } from '../../src/app.js';
import {
  processExportJob,
  type ExportJobPayload
} from '../../../worker/src/processors/export.processor.js';
import { seedNativeResults, nativeIds } from '../helpers/native-fixture.js';
import { ids } from '../helpers/database.js';
import { decodeMvtPoints } from '../../../../scripts/phase4/mvt.mjs';

describe('Phase 4 selection matches Phase 3 on PostgreSQL/PostGIS', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = createApp({ logger: false });
  const keys: string[] = [];
  const path = `/api/v1/analyses/${nativeIds.analysis}`;
  beforeAll(() => app.ready());
  beforeEach(async () => {
    await seedNativeResults(pool);
    await select('standard_only', ['terra']);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await disconnectDatabase();
    for (const key of keys) await localExportStorage.remove(key);
  });
  async function select(mode: string, sources: string[]) {
    await pool.query('UPDATE firebridge.analyses SET request_spec=$2,cache_key=$3 WHERE id=$1', [
      nativeIds.analysis,
      JSON.stringify({ data_mode: mode, source_ids: sources }),
      randomUUID()
    ]);
  }
  async function batch() {
    return prisma.$transaction(
      async (tx) => {
        const context = await findResultContext(nativeIds.analysis, tx);
        expect(context?.snapshot_status).toBe('ready');
        return readDetectionBatch(tx, nativeIds.analysis, {}, '0', 100, context!);
      },
      { isolationLevel: 'RepeatableRead' }
    );
  }
  async function tileCount() {
    const tile = await app.inject(path + '/tiles/detections/0/0/0.mvt');
    expect(tile.statusCode, tile.body).toBe(200);
    return decodeMvtPoints(tile.rawPayload)
      .flatMap((l: { features: { properties: { count: number } }[] }) => l.features)
      .reduce((sum: number, f: { properties: { count: number } }) => sum + f.properties.count, 0);
  }
  it('keeps Terra-only exports and decoded map totals identical to native reads', async () => {
    const native = await app.inject(path + '/detections');
    expect(native.statusCode, native.body).toBe(200);
    const rows = await batch();
    expect(rows.map((r) => r.source_id)).toEqual(['terra', 'terra']);
    expect(rows.map((r) => r.id).sort()).toEqual(
      native
        .json()
        .data.features.map(
          (r: { properties: { detection_id: string } }) => r.properties.detection_id
        )
        .sort()
    );
    expect(await tileCount()).toBe(2);
  });
  it('honors a saved NRT selection and refuses an unsupported best-available policy', async () => {
    await select('nrt_only', ['terra']);
    const rows = await batch();
    expect(rows.map((r) => r.id)).toEqual(['9007199254740998']);
    expect(await tileCount()).toBe(1);
    await select('best_available', ['terra']);
    expect((await app.inject(path + '/tiles/detections/0/0/0.mvt')).statusCode).toBe(409);
  });
  it('rejects mismatched satellite versions before returning a cached tile or accepting exports', async () => {
    expect(await tileCount()).toBe(2);
    await pool.query(
      `UPDATE firebridge.analysis_components SET release_id=$2 WHERE analysis_id=$1 AND component='satellite'`,
      [nativeIds.analysis, ids.next]
    );
    expect((await app.inject(path + '/tiles/detections/0/0/0.mvt')).statusCode).toBe(409);
    const exportResult = await app.inject({
      method: 'POST',
      url: path + '/exports',
      payload: { format: 'csv' },
      headers: { 'idempotency-key': randomUUID() }
    });
    expect(exportResult.statusCode).toBe(409);
    expect(
      (await pool.query(`SELECT count(*) FROM firebridge.api_jobs WHERE kind='export'`)).rows[0]
        .count
    ).toBe('0');
  });
  it.each(['serving_complete=false', 'row_count=row_count+1'])(
    'refuses an incomplete SQL slice: %s',
    async (change) => {
      expect(await tileCount()).toBe(2);
      await pool.query(`UPDATE firebridge.data_partitions SET ${change} WHERE id=$1`, [
        nativeIds.partition
      ]);
      expect((await app.inject(path + '/detections')).statusCode).toBe(409);
      expect((await app.inject(path + '/tiles/detections/0/0/0.mvt')).statusCode).toBe(409);
    }
  );
  it('keeps map and export reads pinned after the latest alias moves', async () => {
    await pool.query('UPDATE firebridge.release_aliases SET release_id=$1', [ids.next]);
    expect((await findResultContext(nativeIds.analysis))?.release_id).toBe(ids.current);
    expect(await batch()).toHaveLength(2);
    expect(await tileCount()).toBe(2);
  });
  it('creates a durable export, processes the real CSV, and downloads exactly the selected records', async () => {
    const request = {
      method: 'POST' as const,
      url: path + '/exports',
      payload: { format: 'csv' },
      headers: { 'idempotency-key': randomUUID() }
    };
    const created = await app.inject(request);
    expect(created.statusCode, created.body).toBe(202);
    const job = created.json().data.job_id;
    await processExportJob({
      data: { job_id: job },
      opts: { attempts: 3 },
      attemptsMade: 0
    } as Job<ExportJobPayload>);
    const metadata = (
      await pool.query(
        'SELECT status,result_manifest_uri,progress FROM firebridge.api_jobs WHERE id=$1',
        [job]
      )
    ).rows[0];
    keys.push(metadata.result_manifest_uri);
    expect(metadata).toMatchObject({ status: 'succeeded', progress: { rows: 2 } });
    const unsigned = await app.inject('/api/v1/jobs/' + job + '/download');
    expect(unsigned.statusCode, unsigned.body).toBe(400);
    expect(unsigned.json().code).toBe('INVALID_DOWNLOAD_LINK');
    const jobResponse = await app.inject('/api/v1/jobs/' + job);
    expect(jobResponse.statusCode, jobResponse.body).toBe(200);
    const downloadUrl = jobResponse.json().data.download_url;
    expect(downloadUrl).toEqual(expect.stringContaining(`/api/v1/jobs/${job}/download?`));
    const file = await app.inject(downloadUrl);
    expect(file.statusCode, file.body).toBe(200);
    expect(file.body.trim().split(/\r?\n/)).toHaveLength(3);
    expect(file.body).toContain('terra');
    expect(file.body).not.toContain('aqua');
    const replay = await app.inject(request);
    expect(replay.json().data.job_id).toBe(job);
  });
  it('rejects an export filter outside the frozen sources before creating a job', async () => {
    const response = await app.inject({
      method: 'POST',
      url: path + '/exports',
      payload: { format: 'csv', filters: { source_id: 'aqua' } },
      headers: { 'idempotency-key': randomUUID() }
    });
    expect(response.statusCode, response.body).toBe(422);
  });
});
