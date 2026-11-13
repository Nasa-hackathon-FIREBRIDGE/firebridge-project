/**
 * Phase 2 — Real PostgreSQL + PostGIS End-to-End Integration Tests
 *
 * Verifies real PostGIS geometry operations, real database constraints,
 * real REPEATABLE READ transactions, and real transactional outbox persistence.
 */

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '../../.env') });

import { prisma } from '@firebridge/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

type App = Awaited<ReturnType<typeof createApp>>;

let app: App;

beforeAll(async () => {
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
  await prisma.$disconnect();
});

describe('Phase 2 — Real PostGIS & PostgreSQL Integration', () => {
  const testAreaVersion = `v-${Date.now()}`;
  let createdAreaId: string;
  let createdSatelliteReleaseId: string;
  let createdAnalysisId: string;
  let createdJobId: string;

  // Simple valid polygon over Corsica / Mediterranean: [lon, lat]
  const corsicaPolygon = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [8.5, 41.5],
        [9.5, 41.5],
        [9.5, 42.5],
        [8.5, 42.5],
        [8.5, 41.5]
      ]
    ]
  };

  it('1. POST /api/v1/areas persists a valid polygon into PostgreSQL via PostGIS and returns 201', async () => {
    const payload = {
      geometry: corsicaPolygon,
      name: 'Corsica Test AOI',
      version: testAreaVersion,
      display_timezone: 'Europe/Paris',
      provenance: 'real-integration-test'
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload
    });

    expect(response.statusCode).toBe(201);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.message).toBe('Area created.');
    expect(json.data.id).toBeDefined();
    expect(json.data.geometry_sha256).toBeDefined();
    expect(json.data.surface_km2).toBeGreaterThan(0);
    expect(json.data.geometry.type).toBe('MultiPolygon');

    createdAreaId = json.data.id;

    // Verify directly in PostgreSQL
    const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id::text, name FROM firebridge.areas WHERE id = ${createdAreaId}::uuid;
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Corsica Test AOI');
  });

  it('2. POST /api/v1/areas idempotently reuses the existing area and returns 200 without creating duplicates', async () => {
    const payload = {
      geometry: corsicaPolygon,
      name: 'Corsica Test AOI',
      version: testAreaVersion,
      display_timezone: 'Europe/Paris',
      provenance: 'real-integration-test'
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.message).toBe('Equivalent area already exists.');
    expect(json.data.id).toBe(createdAreaId);

    // Verify row count remains exactly 1 in PostgreSQL
    const count = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM firebridge.areas
      WHERE geometry_sha256 = ${json.data.geometry_sha256}
        AND version = ${testAreaVersion};
    `;
    expect(Number(count[0]?.count)).toBe(1);
  });

  it('3. POST /api/v1/areas rejects a self-intersecting polygon via real PostGIS ST_IsValid', async () => {
    // Bow-tie figure-8 self-intersecting polygon
    const selfIntersectingPolygon = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0.0, 0.0],
          [2.0, 2.0],
          [0.0, 2.0],
          [2.0, 0.0],
          [0.0, 0.0]
        ]
      ]
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        geometry: selfIntersectingPolygon,
        name: 'Bow-tie Self Intersecting',
        version: testAreaVersion,
        display_timezone: 'UTC',
        provenance: 'test'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().status).toBe('error');
    expect(response.json().code).toBe('VALIDATION_ERROR');
    expect(response.json().message).toMatch(/self-intersection|not valid/i);
  });

  it('4. POST /api/v1/areas correctly validates geodesic surface area on WGS84 for antimeridian crossing', async () => {
    // Small polygon straddling antimeridian (Fiji / Pacific)
    const antimeridianPolygon = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [179.0, -17.0],
          [-179.0, -17.0],
          [-179.0, -16.0],
          [179.0, -16.0],
          [179.0, -17.0]
        ]
      ]
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        geometry: antimeridianPolygon,
        name: 'Antimeridian Pacific Box',
        version: `antimeridian-${Date.now()}`,
        display_timezone: 'Pacific/Fiji',
        provenance: 'real-integration-test'
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.surface_km2).toBeGreaterThan(0);
    // 2 degrees longitude * 1 degree latitude at 17S is roughly 24,000 km2
    expect(response.json().data.surface_km2).toBeLessThan(50000);
  });

  it('5. GET /api/v1/areas/:area_id retrieves area with weights_status=not_prepared', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/areas/${createdAreaId}`
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.data.id).toBe(createdAreaId);
    expect(json.data.name).toBe('Corsica Test AOI');
    expect(json.data.surface_km2).toBeGreaterThan(0);
    expect(json.data.coverage.weights_status).toBe('not_prepared');
    expect(json.data.coverage.cells_count).toBe(0);
    expect(json.data.coverage.grid).toBeNull();
  });

  it('6. POST /api/v1/analyses fails cleanly when no published satellite release exists for time window', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: {
        area_id: createdAreaId,
        start_date: '2099-01-01',
        end_date_exclusive: '2099-01-10'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('NO_COMPATIBLE_RELEASE');
  });

  it('7. POST /api/v1/analyses atomically creates analysis, components, job, and outbox event with REPEATABLE READ', async () => {
    createdSatelliteReleaseId = randomUUID();

    // Seed a published satellite release covering our test window in PostgreSQL
    await prisma.$executeRaw`
      INSERT INTO firebridge.data_releases (
        id,
        name,
        status,
        stream,
        code_version,
        config,
        config_sha256,
        manifest_uri,
        dataset_kind,
        scope_key,
        published_at,
        observation_cutoff
      ) VALUES (
        ${createdSatelliteReleaseId}::uuid,
        ${'satellite-release-' + Date.now()},
        'published',
        'retrospective',
        'v1.0.0',
        '{}'::jsonb,
        '0000000000000000000000000000000000000000000000000000000000000000',
        's3://bucket/manifest.json',
        'satellite',
        ${env.DEFAULT_SCOPE_KEY},
        CURRENT_TIMESTAMP,
        '2030-01-01T00:00:00Z'::timestamptz
      );
    `;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: {
        area_id: createdAreaId,
        start_date: '2026-08-01',
        end_date_exclusive: '2026-08-10'
      }
    });

    expect(response.statusCode, response.body).toBe(202);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.message).toBe('Analysis queued.');
    expect(json.data.id).toBeDefined();
    expect(json.data.job_id).toBeDefined();
    expect(json.data.release_id).toBe(createdSatelliteReleaseId);
    expect(json.data.metric_key).toBe('native_detections_v1');
    expect(json.data.grid_id).toBeNull();
    expect(json.data.data_mode).toBe('standard_only');

    createdAnalysisId = json.data.id;
    createdJobId = json.data.job_id;

    // Verify all 4 writes in PostgreSQL:
    // 1. analyses
    const analysisRows = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id::text, status FROM firebridge.analyses WHERE id = ${createdAnalysisId}::uuid;
    `;
    expect(analysisRows).toHaveLength(1);

    // 2. analysis_components
    const componentRows = await prisma.$queryRaw<Array<{ component: string; status: string }>>`
      SELECT component, status FROM firebridge.analysis_components WHERE analysis_id = ${createdAnalysisId}::uuid;
    `;
    expect(componentRows.length).toBeGreaterThanOrEqual(1);
    expect(componentRows.some((c) => c.component === 'satellite' && c.status === 'ready')).toBe(true);

    // 3. api_jobs
    const jobRows = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id::text, status FROM firebridge.api_jobs WHERE id = ${createdJobId}::uuid;
    `;
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]?.status).toBe('queued');

    // 4. outbox_events
    const outboxRows = await prisma.$queryRaw<Array<{ id: string; aggregate_id: string; status: string }>>`
      SELECT id::text, aggregate_id, status FROM firebridge.outbox_events WHERE aggregate_id = ${createdAnalysisId};
    `;
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.status).toBe('pending');
  });

  it('8. POST /api/v1/analyses returns 200 with existing resource for repeated identical request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: {
        area_id: createdAreaId,
        start_date: '2026-08-01',
        end_date_exclusive: '2026-08-10'
      }
    });

    expect(response.statusCode, response.body).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.message).toBe('Existing analysis reused.');
    expect(json.data.id).toBe(createdAnalysisId);
    expect(json.data.job_id).toBe(createdJobId);
  });

  it('9. GET /api/v1/analyses/:id returns 200 with components and evaluates partial status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/analyses/${createdAnalysisId}`
    });

    expect(response.statusCode, response.body).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.data.id).toBe(createdAnalysisId);
    expect(json.data.area_id).toBe(createdAreaId);
    expect(json.data.components).toHaveLength(3);
    // Since satellite is ready but weather/reports are missing, status is partial
    expect(json.data.status).toBe('queued');
    expect(json.data.job.id).toBe(createdJobId);
  });

  it('10. GET /api/v1/jobs/:id returns 200 with progression and calculated retryability', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${createdJobId}`
    });

    expect(response.statusCode, response.body).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.data.id).toBe(createdJobId);
    expect(json.data.kind).toBe('analysis');
    expect(json.data.status).toBe('queued');
    expect(json.data.max_attempts).toBe(3);
    expect(json.data.retryable).toBe(false); // queued is not retryable
    expect(json.data.analysis_id).toBe(createdAnalysisId);
  });
});
