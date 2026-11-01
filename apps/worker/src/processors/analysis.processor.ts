/**
 * Analysis Job Processor
 *
 * Consumes `analysis.requested` jobs from the BullMQ queue and executes the
 * analysis lifecycle, advancing stages and updating component and job statuses.
 */

import { prisma } from '@firebridge/database';
import type { Job } from 'bullmq';
import { logger } from '../config/logger.js';

export interface AnalysisJobPayload {
  analysis_id: string;
  job_id: string;
  area_id: string;
  metric_key: string;
  start_date: string;
  end_date_exclusive: string;
}

export async function processAnalysisJob(job: Job<AnalysisJobPayload>): Promise<void> {
  const { analysis_id, job_id, area_id } = job.data;

  logger.info(
    { jobId: job.id, analysisId: analysis_id, apiJobId: job_id },
    'Processing analysis job'
  );

  try {
    // 1. Transition to running state
    await prisma.$executeRaw`
      UPDATE firebridge.api_jobs
      SET
        status = 'running',
        attempt = attempt + 1,
        progress = '{"stage": "checking_selection"}'::jsonb
      WHERE id = ${job_id}::uuid;
    `;

    await prisma.$executeRaw`
      UPDATE firebridge.analyses
      SET status = 'running'
      WHERE id = ${analysis_id}::uuid;
    `;

    // 2. Verify analysis and area exist
    const analysisRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM firebridge.analyses WHERE id = ${analysis_id}::uuid LIMIT 1;
    `;
    if (analysisRows.length === 0) {
      throw new Error(`Analysis with id '${analysis_id}' does not exist.`);
    }

    const areaRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM firebridge.areas WHERE id = ${area_id}::uuid LIMIT 1;
    `;
    if (areaRows.length === 0) {
      throw new Error(`Area with id '${area_id}' does not exist.`);
    }

    // This processor currently verifies lifecycle metadata. Native result routes
    // execute bounded queries; no detection loading or aggregation happens here.
    await prisma.$executeRaw`
      UPDATE firebridge.api_jobs
      SET progress = '{"stage": "checking_components"}'::jsonb
      WHERE id = ${job_id}::uuid;
    `;

    // 5. Check components to determine final status
    type ComponentRow = {
      component: string;
      status: string;
      release_id: string | null;
    };

    const components = await prisma.$queryRaw<ComponentRow[]>`
      SELECT component, status, release_id::text
      FROM firebridge.analysis_components
      WHERE analysis_id = ${analysis_id}::uuid;
    `;

    const satelliteComponent = components.find((c) => c.component === 'satellite');
    const nonSatelliteComponents = components.filter((c) => c.component !== 'satellite');

    const satelliteReady = satelliteComponent?.status === 'ready';
    const hasIncompleteOtherComponents = nonSatelliteComponents.some((c) => c.status !== 'ready');

    let finalAnalysisStatus: 'ready' | 'partial' = 'ready';
    let finalJobStatus: 'succeeded' | 'partial' = 'succeeded';

    if (satelliteReady && hasIncompleteOtherComponents) {
      finalAnalysisStatus = 'partial';
      finalJobStatus = 'partial';
    }

    // 6. Complete analysis and job
    await prisma.$executeRaw`
      UPDATE firebridge.analyses
      SET
        status = ${finalAnalysisStatus},
        completed_at = now()
      WHERE id = ${analysis_id}::uuid;
    `;

    await prisma.$executeRaw`
      UPDATE firebridge.api_jobs
      SET
        status = ${finalJobStatus},
        progress = '{"stage": "completed"}'::jsonb,
        completed_at = now()
      WHERE id = ${job_id}::uuid;
    `;

    logger.info(
      { analysisId: analysis_id, apiJobId: job_id, status: finalAnalysisStatus },
      'Analysis job completed successfully'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      { err: error, analysisId: analysis_id, apiJobId: job_id },
      'Analysis job processing failed'
    );

    await prisma.$executeRaw`
      UPDATE firebridge.analyses
      SET
        status = 'failed',
        error_code = 'PROCESSING_ERROR',
        completed_at = now()
      WHERE id = ${analysis_id}::uuid;
    `;

    await prisma.$executeRaw`
      UPDATE firebridge.api_jobs
      SET
        status = 'failed',
        error_code = 'PROCESSING_ERROR',
        completed_at = now()
      WHERE id = ${job_id}::uuid;
    `;

    throw new Error(`Job processing failed: ${errorMessage}`);
  }
}
