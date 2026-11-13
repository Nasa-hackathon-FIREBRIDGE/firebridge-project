import type { FastifyRequest, FastifyReply } from 'fastify';
import { healthService } from '../services/health.service.js';
import { envelope } from '../utils/response.js';

export const healthController = {
  getLiveStatus: async (request: FastifyRequest, reply: FastifyReply) =>
    reply.header('Cache-Control', 'no-store').status(200).send(envelope(request, healthService.getLiveStatus())),
  async getReadiness(request: FastifyRequest, reply: FastifyReply) {
    const result = await healthService.getReadiness(
      request.server.phase1ReadinessProvider,
      request.server.readinessChecks
    );
    return reply.header('Cache-Control', 'no-store').status(result.status === 'ok' ? 200 : 503).send(envelope(request, result));
  }
};
