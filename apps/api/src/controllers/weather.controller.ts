import type { FastifyReply, FastifyRequest } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const weatherController = {
  list: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Weather listing is not implemented yet.')),
  getByLocation: async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send(plannedResponse('Weather detail lookup is not implemented yet.'))
};
