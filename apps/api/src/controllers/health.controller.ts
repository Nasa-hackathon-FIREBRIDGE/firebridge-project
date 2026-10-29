import type { FastifyRequest, FastifyReply } from 'fastify';
import { healthService } from '../services/health.service.js';

export const healthController = {
  getLiveStatus: async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.status(200).send(healthService.getLiveStatus()),
  async getReadiness(request: FastifyRequest, reply: FastifyReply) {
    const result = await healthService.getReadiness(
      request.server.phase1ReadinessProvider,
      request.server.readinessChecks
    );
    return reply.status(result.status === 'ok' ? 200 : 503).send(result);
  }
};
