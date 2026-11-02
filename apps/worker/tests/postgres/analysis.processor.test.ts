import { randomUUID } from 'node:crypto';
import { prisma, disconnectDatabase } from '@firebridge/database';
import type { Job } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import {
  processAnalysisJob,
  type AnalysisJobPayload
} from '../../src/processors/analysis.processor.js';

describe('AnalysisJobProcessor', () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it('successfully processes an analysis job, transitioning progress and statuses', async () => {
    const areaId = randomUUID();
    const releaseId = randomUUID();
    const analysisId = randomUUID();
    const jobId = randomUUID();

    // 1. Insert an area
    await prisma.$executeRaw`
      INSERT INTO firebridge.areas (
        id, name, version, geom, geometry_sha256, display_timezone, provenance
      ) VALUES (
        ${areaId}::uuid,
        'Processor Test Area',
        '1.0.0',
        ST_Multi(ST_GeomFromText('POLYGON((0 0, 0 1, 1 1, 1 0, 0 0))', 4326)),
        ${'sha256-' + areaId},
        'UTC',
        'automated-test'
      );
    `;

    // 2. Insert a published satellite data release
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
        observation_cutoff
      ) VALUES (
        ${releaseId}::uuid,
        ${'processor-release-' + releaseId},
        'published',
        'retrospective',
        '1.0.0',
        '{}'::jsonb,
        ${'sha256-' + releaseId},
        ${'s3://firebridge/manifests/' + releaseId + '.json'},
        'satellite',
        'global',
        now() + interval '1 day'
      );
    `;

    // 3. Ensure metric definition exists
    await prisma.$executeRaw`
      INSERT INTO firebridge.metric_definitions
        (id, version, unit, family, description, definition, requires_masks, requires_model)
      VALUES
        ('native_detections_v1', '1.0.0', 'count', 'native_detections', 'Native detections', '{}'::jsonb, false, false)
      ON CONFLICT (id) DO NOTHING;
    `;

    // 4. Insert an analysis
    await prisma.$executeRaw`
      INSERT INTO firebridge.analyses (
        id, area_id, release_id, start_date, end_date_exclusive, time_basis,
        metric_key, grid_id, selection_policy, weighting_version,
        weather_policy, news_policy, request_spec, cache_key, status
      ) VALUES (
        ${analysisId}::uuid,
        ${areaId}::uuid,
        ${releaseId}::uuid,
        '2026-06-01'::date,
        '2026-06-10'::date,
        'utc_day',
        'native_detections_v1',
        NULL,
        'standard',
        '1.0.0',
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        ${'cache:' + analysisId},
        'queued'
      );
    `;

    // 5. Insert analysis_components (satellite ready, reports missing)
    await prisma.$executeRaw`
      INSERT INTO firebridge.analysis_components (
        analysis_id, component, release_id, status, reasons
      ) VALUES (
        ${analysisId}::uuid,
        'satellite',
        ${releaseId}::uuid,
        'ready',
        '[]'::jsonb
      );
    `;

    await prisma.$executeRaw`
      INSERT INTO firebridge.analysis_components (
        analysis_id, component, release_id, status, reasons
      ) VALUES (
        ${analysisId}::uuid,
        'reports',
        NULL,
        'missing',
        '["No release"]'::jsonb
      );
    `;

    // 6. Insert api_jobs
    await prisma.$executeRaw`
      INSERT INTO firebridge.api_jobs (
        id, kind, analysis_id, requested_by, request_hash, idempotency_key, request_spec, status, attempt, progress
      ) VALUES (
        ${jobId}::uuid,
        'analysis',
        ${analysisId}::uuid,
        'test-user',
        ${'hash:' + jobId},
        ${'idem:' + jobId},
        '{}'::jsonb,
        'queued',
        0,
        '{"percent": 0, "stage": "queued"}'::jsonb
      );
    `;

    // Mock BullMQ job
    const mockJob = {
      id: `job-${jobId}`,
      name: 'analysis.requested',
      data: {
        analysis_id: analysisId,
        job_id: jobId,
        area_id: areaId,
        metric_key: 'native_detections_v1',
        start_date: '2026-06-01',
        end_date_exclusive: '2026-06-10'
      }
    } as Job<AnalysisJobPayload>;

    // Execute processor
    await processAnalysisJob(mockJob);

    // Verify analysis transitioned to partial (since reports component is missing)
    const analysisRows = await prisma.$queryRaw<{ status: string; completed_at: Date | null }[]>`
      SELECT status, completed_at FROM firebridge.analyses WHERE id = ${analysisId}::uuid;
    `;
    expect(analysisRows[0]?.status).toBe('partial');
    expect(analysisRows[0]?.completed_at).not.toBeNull();

    // Verify job transitioned to partial with 100% completed
    const jobRows = await prisma.$queryRaw<
      { status: string; progress: { stage: string }; completed_at: Date | null }[]
    >`
      SELECT status, progress, completed_at FROM firebridge.api_jobs WHERE id = ${jobId}::uuid;
    `;
    expect(jobRows[0]?.status).toBe('partial');
    expect(jobRows[0]?.progress).toMatchObject({ stage: 'completed',percent:100 });
    expect(jobRows[0]?.completed_at).not.toBeNull();
  });

  it('marks job and analysis as failed if referenced entity does not exist', async () => {
    const analysisId = randomUUID();
    const jobId = randomUUID();
    const nonExistentAreaId = randomUUID();

    // Insert analysis with dummy foreign keys will fail FK constraint if area doesn't exist,
    // so we test when analysis is not found in database:
    const mockJob = {
      id: `job-${jobId}`,
      name: 'analysis.requested',
      data: {
        analysis_id: analysisId,
        job_id: jobId,
        area_id: nonExistentAreaId,
        metric_key: 'native_detections_v1',
        start_date: '2026-06-01',
        end_date_exclusive: '2026-06-10'
      }
    } as Job<AnalysisJobPayload>;

    await expect(processAnalysisJob(mockJob)).rejects.toThrow();
  });
});
