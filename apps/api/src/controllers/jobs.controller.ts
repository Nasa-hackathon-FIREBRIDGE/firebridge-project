/**
 * Jobs controller — Fastify-native handlers
 *
 * GET /api/v1/jobs/:id — Endpoint 10 (Retrieve job progress & retryability)
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { jobsService } from '../services/jobs.service.js';
import { ErrorCodes } from '../types/api.js';
import { plannedResponse } from '../utils/planned-response.js';

export const jobsController = {
  /**
   * GET /api/v1/jobs (scaffolded)
   */
  async list(_req: FastifyRequest, reply: FastifyReply) {
    return reply.code(501).send(plannedResponse('Job listing is not implemented yet.'));
  },

  /**
   * GET /api/v1/jobs/:id — Endpoint 10
   */
  async getById(req: FastifyRequest, reply: FastifyReply) {
    const params = req.params as Record<string, string | undefined>;
    const jobId = params.id;

    if (!jobId) {
      return reply.code(400).send({
        status: 'error',
        code: ErrorCodes.BAD_REQUEST,
        message: 'Job ID is required.',
        data: null
      });
    }

    const job = await jobsService.getJobById(jobId);

    return reply.code(200).send({
      status: 'ok',
      message: 'Job retrieved.',
      data: job
    });
  }
};
