/**
 * Jobs controller — Fastify-native handlers
 *
 * GET /api/v1/jobs/:id — Endpoint 10 (Retrieve job progress & retryability)
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { jobsService } from '../services/jobs.service.js';
import { parseResultInput, resultIdSchema } from '../validators/results.validator.js';
import { jobsListQuerySchema } from '../validators/jobs.validator.js';

export const jobsController = {
  /**
   * GET /api/v1/jobs (scaffolded)
   */
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = parseResultInput(jobsListQuerySchema, req.query);
    return reply.header('Cache-Control', 'private, no-store').send({ status: 'ok', message: 'Jobs retrieved.',
      data: await jobsService.list(query) });
  },

  /**
   * GET /api/v1/jobs/:id — Endpoint 10
   */
  async getById(req: FastifyRequest, reply: FastifyReply) {
    const { id: jobId } = parseResultInput(resultIdSchema, req.params);
    const job = await jobsService.getJobById(jobId);
    reply.header('Cache-Control', 'private, no-store');

    return reply.code(200).send({
      status: 'ok',
      message: 'Job retrieved.',
      data: job
    });
  }
};
