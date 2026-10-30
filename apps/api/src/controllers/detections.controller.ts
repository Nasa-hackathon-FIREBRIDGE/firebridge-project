import type { FastifyReply, FastifyRequest } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const detectionsController = {
  list: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Detection listing is not implemented yet.')),
  create: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Detection creation is not implemented yet.'))
};
