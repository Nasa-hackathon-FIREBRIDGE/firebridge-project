import type { FastifyReply, FastifyRequest } from 'fastify';
import { healthService } from '../services/health.service.js';

export const healthController = {
  async getLiveStatus(_req: FastifyRequest, reply: FastifyReply) {
    return reply.code(200).send(healthService.getLiveStatus());
  },

  async getReadiness(_req: FastifyRequest, reply: FastifyReply) {
    // Errors are rethrown to Fastify's error handler, as next(error) was before.
    const result = await healthService.getReadiness();
    return reply.code(result.status === 'ok' ? 200 : 503).send(result);
  }
};