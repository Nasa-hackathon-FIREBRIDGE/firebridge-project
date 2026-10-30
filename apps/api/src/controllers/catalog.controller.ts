import type { FastifyReply, FastifyRequest } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const catalogController = {
  list: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Catalog listing is not implemented yet.')),
  getById: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Catalog detail lookup is not implemented yet.'))
};
