import type { FastifyRequest, FastifyReply } from 'fastify';
import { healthService } from '../services/health.service.js';
import { envelope } from '../utils/response.js';

export const healthController = {
  getLiveStatus: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.send(healthService.getLiveStatus()),
  getReadiness: async (request: FastifyRequest, reply: FastifyReply) =>
    reply.send(envelope(request, await request.server.catalogService.ready()))
};
