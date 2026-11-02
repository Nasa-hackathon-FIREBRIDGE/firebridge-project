/**
 * Analyses controller — Fastify-native handlers
 *
 * POST /api/v1/analyses     — Endpoint 8 (Create or reuse analysis)
 * GET  /api/v1/analyses/:id — Endpoint 9 (Retrieve analysis & component statuses)
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { analysesService } from '../services/analyses.service.js';
import { ErrorCodes } from '../types/api.js';
import { parseResultInput, resultIdSchema } from '../validators/results.validator.js';
import {
  analysisCreateSchema,
  analysisListQuerySchema
} from '../validators/analyses.validator.js';

export const analysesController = {
  /**
   * GET /api/v1/analyses — List analyses with cursor pagination
   */
  async list(req: FastifyRequest, reply: FastifyReply) {
    reply.header('Cache-Control', 'private, no-store');
    const parsed = analysisListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        status: 'error',
        code: ErrorCodes.INVALID_QUERY,
        message: 'Invalid analysis query parameters.',
        data: null
      });
    }

    const result = await analysesService.list(parsed.data);

    return reply.code(200).send({
      status: 'ok',
      message: 'Analyses retrieved.',
      data: {
        analyses: result.analyses.map((analysis) => ({
          id: analysis.id,
          status: analysis.status,
          area_id: analysis.area_id,
          release_id: analysis.release_id,
          metric_key: analysis.metric_key,
          grid_id: analysis.grid_id,
          data_mode: 'standard_only',
          start_date: analysis.start_date,
          end_date_exclusive: analysis.end_date_exclusive,
          time_basis: analysis.time_basis,
          created_at: analysis.created_at,
          completed_at: analysis.completed_at
        })),
        nextCursor: result.nextCursor
      }
    });
  },

  /**
   * POST /api/v1/analyses — Endpoint 8
   */
  async create(req: FastifyRequest, reply: FastifyReply) {
    const requestedBy = 'anonymous';
    reply.header('Cache-Control', 'private, no-store');
    const parsed = analysisCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        status: 'error',
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Invalid analysis payload.',
        data: null
      });
    }

    const idempotencyHeader = req.headers['idempotency-key'] as string | undefined;

    const { detail, created } = await analysesService.createAnalysis(
      parsed.data,
      requestedBy,
      idempotencyHeader
    );

    const statusCode = created ? 202 : 200;
    const message = created ? 'Analysis queued.' : 'Existing analysis reused.';

    return reply.code(statusCode).send({
      status: 'ok',
      message,
      data: {
        id: detail.analysis.id,
        status: detail.analysis.status,
        area_id: detail.analysis.area_id,
        release_id: detail.analysis.release_id,
        metric_key: detail.analysis.metric_key,
        grid_id: detail.analysis.grid_id,
        data_mode: 'standard_only',
        start_date: detail.analysis.start_date,
        end_date_exclusive: detail.analysis.end_date_exclusive,
        job_id: detail.job?.id ?? null,
        created_at: detail.analysis.created_at
      }
    });
  },

  /**
   * GET /api/v1/analyses/:id — Endpoint 9
   */
  async getById(req: FastifyRequest, reply: FastifyReply) {
    const { id: analysisId } = parseResultInput(resultIdSchema, req.params);
    const detail = await analysesService.getAnalysisById(analysisId);
    reply.header('Cache-Control', 'private, no-store');

    return reply.code(200).send({
      status: 'ok',
      message: 'Analysis retrieved.',
      data: {
        id: detail.analysis.id,
        status: detail.analysis.status,
        area_id: detail.analysis.area_id,
        metric_key: detail.analysis.metric_key,
        grid_id: detail.analysis.grid_id,
        data_mode: 'standard_only',
        start_date: detail.analysis.start_date,
        end_date_exclusive: detail.analysis.end_date_exclusive,
        time_basis: detail.analysis.time_basis,
        release_id: detail.analysis.release_id,
        components: detail.components.map((c) => ({
          component: c.component,
          release_id: c.release_id,
          status: c.status,
          reasons: c.reasons
        })),
        job: detail.job
          ? {
              id: detail.job.id,
              status: detail.job.status,
              progress: detail.job.progress,
              attempt: detail.job.attempt
            }
          : null,
        error_code: detail.analysis.error_code,
        created_at: detail.analysis.created_at,
        completed_at: detail.analysis.completed_at
      }
    });
  }
};
