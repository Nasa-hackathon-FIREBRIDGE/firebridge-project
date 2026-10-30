import type { FastifyReply, FastifyRequest } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const releasesController = {
  list: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Release listing is not implemented yet.')),
  getById: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Release detail lookup is not implemented yet.'))
};
