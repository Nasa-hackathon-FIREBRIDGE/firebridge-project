import type { FastifyReply, FastifyRequest } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const cellsController = {
  list: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Cell listing is not implemented yet.')),
  getById: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Cell detail lookup is not implemented yet.'))
};
